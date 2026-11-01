import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faCircleXmark } from '@fortawesome/free-regular-svg-icons';
import { Autotag, Configuration, ListedTask, QueuedTask, TaskArgDefinitionSelectValue } from '@vimtur/common';
import { Subscription } from 'rxjs';
import { AlertService } from 'services/alert.service';
import { ConfigService } from 'services/config.service';
import { ConfirmationService } from 'services/confirmation.service';
import { TagService } from 'services/tag.service';
import { TasksService } from 'services/tasks.service';
import { LoadingComponent } from '../loading/loading.component';

// Model pack the SigLIP-2 calibration/auto-tag tasks score against. Only this
// pack is exposed by the page, so it is fixed here; a calibration run recorded
// against another pack is stale evidence and is ignored (see calibrationRun).
const AUTOTAG_MODEL_ID = 'AVES-SIGLIP2-B32';

const CALIBRATION_TASK_ID = 'CALIBRATE-SIGLIP2-B32';

// AUTO-TAG task ids follow the server's `AUTO-TAG-${model id}` convention (see
// server/src/tasks/autotag/siglip/tasks.ts and .../mobilenet/classify.ts).
const APPLY_TASK_IDS: Record<'siglip2' | 'mobilenet', string> = {
  siglip2: `AUTO-TAG-${AUTOTAG_MODEL_ID}`,
  mobilenet: 'AUTO-TAG-MOBILE-NET-V2',
};

// 'skip-existing' is the server-side default; 'replace' carries a confirmation
// message in its ListedTask argument definition (see config.component.ts's
// startAction for the general task-argument pattern).
const MODE_SKIP_EXISTING = 'skip-existing';

// The attention sentence lists at most this many tags before collapsing the
// rest into "and N more"; an untagged library can flag every tag at once.
const ATTENTION_PREVIEW_LIMIT = 5;

// Status vocabulary in one place: the table badges AND the legend read from here, so a new status or rename updates everywhere and heads off silent drift.
const STATUS_BADGE_CLASSES: Record<Autotag.TagStatus, string> = {
  'Calibrated': 'text-bg-success',
  'Review (low support)': 'text-bg-warning',
  'Not calibrated': 'text-bg-secondary',
  'Manually overridden': 'text-bg-info',
};

// Every status must have a legend entry; Object.entries keeps the declared display order.
const STATUS_LEGEND: Record<Autotag.TagStatus, string> = {
  'Calibrated': 'meets the support floor and applies automatically.',
  'Review (low support)': 'below the support floor: tag more media or improve the description and re-run calibration — or override the threshold manually.',
  'Not calibrated': 'missing a calibrated threshold: it needs tagged examples and a calibration run; a threshold you type yourself is applied as-is.',
  'Manually overridden':
    'typed in by you and applied as-is — an explicit override of the calibration floor; expect notably worse precision until it is calibrated.',
};

// A table row derived per render from the DB tag list, the config overlay and
// the last calibration run. Deriving instead of storing keeps a config write or
// a finished run from leaving a row showing stale state.
interface AutotagRow {
  tag: string;
  // Editable local description list, persisted wholesale because the server
  // replaces a tag's description array on save.
  descriptions: string[];
  status: Autotag.TagStatus;
  // Threshold recorded by the last calibration run. Display-only: the input
  // edits the manual override, never this value.
  calibratedThreshold?: number;
  support?: number;
  quality?: number;
}

@Component({
  selector: 'app-autotag-config',
  templateUrl: './autotag-config.component.html',
  styleUrls: ['./autotag-config.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [FormsModule, FaIconComponent, LoadingComponent, DatePipe],
})
export class AutotagConfigComponent implements OnInit, OnDestroy {
  public readonly faCircleXmark = faCircleXmark;
  public readonly statusBadgeClasses = STATUS_BADGE_CLASSES;
  public readonly statusLegend: ReadonlyArray<{ status: Autotag.TagStatus; description: string }> = (
    Object.entries(STATUS_LEGEND) as [Autotag.TagStatus, string][]
  ).map(([status, description]) => ({ status, description }));

  public config?: Configuration.Main;
  public tags?: string[];
  public addTagModel?: string;
  public applyMode = MODE_SKIP_EXISTING;
  public tasksService: TasksService;

  private lastRun?: Autotag.CalibrationRun;
  private tasks?: ListedTask[];
  private queue?: QueuedTask[];
  // Description edits live here between saves: the row list is derived, but the
  // input must keep a stable array identity to bind against.
  private descriptions: Record<string, string[]> = {};
  // Threshold edits are held until blur: NumberValueAccessor yields null for an
  // empty field and NaN for transient input like a lone "-", so persisting per
  // keystroke would clear or corrupt the override mid-edit.
  private pendingThresholds = new Map<string, number | null>();
  // Previous queue signature for the calibration task, used to spot a run being
  // queued, starting or finishing (any per-entry state change since the last
  // snapshot).
  private calibrationQueueSignature?: string;
  // Latest calibration failure, held explicitly instead of read off the queue
  // tail: the server splices a successful entry out of the queue (task-manager.ts
  // auto-clears a completed run via cancel → splice) while a failed entry stays
  // behind with complete: true and its error. After a failure followed by a
  // success the tail is the OLD failed entry again, so a tail lookup reported
  // "Failed" while Last Run said Complete.
  private calibrationFailure?: string;
  // Per-entry state (`complete:running:aborted:error`) seen in the previous
  // queue snapshot, keyed by queue id, used to detect the transition that raises
  // or clears calibrationFailure. Queue ids reuse freed slots (task-manager.ts
  // allocates the lowest free suffix), so only an entry's own state is compared,
  // never its position.
  private calibrationEntryStates = new Map<string, string>();
  private calibrationSnapshotSeen = false;
  // Set on the Calibrate click and cleared by the next queue emission: it covers
  // the gap between the POST being accepted and the server broadcasting the new
  // entry, so a rapid double-click cannot queue the task twice. Clearing on the
  // very next emission re-syncs with reality, so a rejected start request cannot
  // leave the button disabled forever (the in-flight check then decides).
  private calibrationRequested = false;
  // Monotonic token for loadLastRun: a slower earlier GET must not overwrite the
  // result of a newer one when two queue transitions fire overlapping requests.
  private loadRunToken = 0;
  private subscriptions: Subscription[] = [];

  private configService: ConfigService;
  private tagService: TagService;
  private confirmationService: ConfirmationService;
  private alertService: AlertService;

  public constructor(
    configService: ConfigService,
    tagService: TagService,
    tasksService: TasksService,
    confirmationService: ConfirmationService,
    alertService: AlertService,
  ) {
    this.configService = configService;
    this.tagService = tagService;
    this.tasksService = tasksService;
    this.confirmationService = confirmationService;
    this.alertService = alertService;
  }

  public ngOnInit(): void {
    this.subscriptions.push(
      this.configService.getConfiguration().subscribe(config => {
        this.config = config;
      }),
    );

    this.subscriptions.push(
      this.tagService.getTags().subscribe(tags => {
        this.tags = tags;
      }),
    );

    this.subscriptions.push(
      this.tasksService.getTasks().subscribe(tasks => {
        this.tasks = tasks;
      }),
    );

    this.subscriptions.push(
      this.tasksService.getQueue().subscribe(queue => {
        this.queue = queue;
        // Any emission re-syncs the click latch: it only has to cover the window
        // until the server broadcasts the new entry (see calibrationRequested).
        this.calibrationRequested = false;
        // Refetch the persisted last run whenever a calibration entry is added
        // or changes state: a finished run stores its result before its queue
        // row changes. Per-entry identity+state is used rather than a single
        // present/complete flag so a new run starting while an older, persisted
        // errored entry is still queued always changes the signature.
        const entries = queue.filter(task => task.type === CALIBRATION_TASK_ID);
        const signature = entries.map(task => `${task.id}:${task.complete}:${task.running}:${task.error ?? ''}`).join('|');
        if (this.calibrationQueueSignature !== undefined && signature !== this.calibrationQueueSignature) {
          this.loadLastRun();
        }
        this.calibrationQueueSignature = signature;
        this.syncCalibrationFailure(entries);
      }),
    );

    this.loadLastRun();
  }

  public ngOnDestroy(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  public get selectedModel(): 'siglip2' | 'mobilenet' {
    return this.config?.autotags?.model ?? 'siglip2';
  }

  // The model field only gates which task Apply runs; auto-import always uses the
  // classifier family. Everything else on this page (tag table, statuses,
  // calibration) is SigLIP-2-only, so the template disables those controls
  // rather than hiding the state they describe.
  public get isSiglipSelected(): boolean {
    return this.selectedModel === 'siglip2';
  }

  public get workerCount(): number {
    return this.config?.autotags?.workers ?? 5;
  }

  public get minSupport(): number {
    return this.config?.autotags?.minSupport ?? 8;
  }

  public get calibrationSampleSize(): number {
    return this.config?.autotags?.calibrationSampleSize ?? 500;
  }

  // The last run, provided it was recorded in the pack this page scores
  // against. Thresholds from another pack's embedding space are meaningless
  // here, so a mismatched run is treated as absent (mirrors the server's guard
  // in server/src/tasks/autotag/siglip/tasks.ts).
  public calibrationRun(): Autotag.CalibrationRun | undefined {
    const run = this.lastRun;
    return run && run.modelId === AUTOTAG_MODEL_ID ? run : undefined;
  }

  // Rows are the DB tag list: a config entry without a DB tag is never rendered
  // (the server purges such entries at the next calibration run).
  public rows(): AutotagRow[] {
    const tags = this.tags ?? [];
    return tags.map(tag => {
      const result = this.calibrationRun()?.perTag[tag];
      const threshold = result?.threshold;
      return {
        tag,
        descriptions: this.descriptionsFor(tag),
        calibratedThreshold: typeof threshold === 'number' ? threshold : undefined,
        support: result?.support,
        quality: result?.quality ?? undefined,
        status: this.deriveStatus(tag),
      };
    });
  }

  // Client mirror of deriveTagState in server/src/tasks/autotag/siglip/state.ts;
  // keep the precedence rules in step with the server.
  public deriveStatus(tag: string): Autotag.TagStatus {
    const manual = this.config?.autotags?.tags?.[tag]?.manualThreshold;
    if (typeof manual === 'number') {
      return 'Manually overridden';
    }
    const result = this.calibrationRun()?.perTag[tag];
    if (result && typeof result.threshold === 'number') {
      // TagResult.emitted is a snapshot of the run's own support floor, so it is
      // ignored here: the current floor decides, exactly as deriveTagState does.
      // Below the floor the threshold is recorded but never auto-applied.
      return result.support >= this.minSupport ? 'Calibrated' : 'Review (low support)';
    }
    return 'Not calibrated';
  }

  public thresholdInput(tag: string): number | '' {
    const manual = this.config?.autotags?.tags?.[tag]?.manualThreshold;
    return typeof manual === 'number' ? manual : '';
  }

  public onThresholdChange(tag: string, value: number | null): void {
    this.pendingThresholds.set(tag, value);
  }

  public onThresholdBlur(tag: string): void {
    if (!this.pendingThresholds.has(tag)) {
      return;
    }
    const value = this.pendingThresholds.get(tag);
    this.pendingThresholds.delete(tag);
    if (value === undefined) {
      return;
    }
    // Empty input clears the override (null); zero is a real threshold.
    if (value === null) {
      this.saveTagConfig(tag, { manualThreshold: null });
      return;
    }
    // NumberValueAccessor parses a lone "-" as NaN rather than null. Posting it
    // would serialise to null and silently clear the override, so a non-finite
    // value is left unposted. Nothing is posted for NaN, so there is no config
    // replay and no snap-back: the field keeps the invalid text until the
    // configuration next changes (a reload clears it).
    if (!Number.isFinite(value)) {
      return;
    }
    this.saveTagConfig(tag, { manualThreshold: value });
  }

  public addDescription(tag: string): void {
    this.descriptionsFor(tag).push('');
    this.persistDescriptions(tag);
  }

  // Removing every row is allowed: the server always scores the bare tag and
  // "a photo of {tag}", so zero stored descriptions is a legitimate state.
  public removeDescription(tag: string, index: number): void {
    this.descriptionsFor(tag).splice(index, 1);
    this.persistDescriptions(tag);
  }

  // Description text edits are persisted on blur; the add/remove buttons save
  // immediately. The whole array is written because the server replaces it, and
  // blank rows are dropped here so an editor-only empty row is never stored.
  public persistDescriptions(tag: string): void {
    this.saveTagConfig(tag, {
      descriptions: this.descriptionsFor(tag).filter(description => description.trim() !== ''),
    });
  }

  public saveModel(model: 'siglip2' | 'mobilenet'): void {
    this.configService.updateConfiguration({ autotags: { model } });
  }

  // The number settings persist on the input's `change` event (blur or Enter)
  // rather than per keystroke: intermediate values are wasted writes, and a
  // transient out-of-range value can be stored only to be rejected by the schema
  // afterwards. valueAsNumber is NaN for an empty field, which is ignored so the
  // user can correct it; the schema also bounds the numbers, so an out-of-range
  // write still surfaces as the usual save alert.
  public saveWorkerCount(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }
    this.configService.updateConfiguration({ autotags: { workers: value } });
  }

  public saveMinSupport(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }
    this.configService.updateConfiguration({ autotags: { minSupport: value } });
  }

  public saveCalibrationSampleSize(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }
    this.configService.updateConfiguration({ autotags: { calibrationSampleSize: value } });
  }

  public addTag(): void {
    const tag = this.addTagModel;
    if (!tag) {
      return;
    }
    this.tagService.addTag(tag).subscribe({
      next: () => {
        // Seed an empty description buffer only for a genuinely new tag: an
        // already-configured entry keeps its stored descriptions, which the next
        // replay would otherwise have replaced with []. An absent config entry
        // already means "no descriptions" server-side (the bare tag and
        // "a photo of {tag}" are always scored), so no write is needed here.
        if (this.config?.autotags?.tags?.[tag] === undefined) {
          this.descriptions[tag] = [];
        }
        this.addTagModel = undefined;
      },
      error: (err: HttpErrorResponse) => {
        console.error(err);
        this.alertService.show({
          type: 'warning',
          message: err.error?.message || `Failed to add tag '${tag}'`,
          autoClose: 5000,
        });
      },
    });
  }

  public removeTag(tag: string): void {
    this.confirmationService
      .confirm(`Are you sure you want to delete '${tag}'?`, true)
      .then(result => {
        if (result) {
          // The config entry is intentionally left behind: the server purges
          // entries without a DB tag at the next calibration run.
          this.tagService.deleteTag(tag);
          delete this.descriptions[tag];
        }
      })
      .catch(err => console.warn('Tag deletion confirmation error', err));
  }

  public calibrationStatus(): string {
    const entries = (this.queue ?? []).filter(task => task.type === CALIBRATION_TASK_ID);
    const running = entries.find(task => task.running);
    if (running) {
      return `Running — ${running.current}/${running.max} …`;
    }
    if (entries.some(task => !task.complete)) {
      return 'Queued — waiting for a worker slot.';
    }
    // Failures are tracked explicitly (syncCalibrationFailure) rather than read
    // from the newest queue entry; see the calibrationFailure field comment.
    if (this.calibrationFailure !== undefined) {
      return `Failed — ${this.calibrationFailure}`;
    }
    return 'Idle — not currently running.';
  }

  // A calibration run that is queued or running (or just requested) disables the
  // Calibrate button, so a double click cannot queue the same job twice.
  public calibrationInFlight(): boolean {
    if (this.calibrationRequested) {
      return true;
    }
    return (this.queue ?? []).some(task => task.type === CALIBRATION_TASK_ID && !task.complete);
  }

  public runCalibration(): void {
    if (!this.isSiglipSelected || this.calibrationInFlight()) {
      return;
    }
    // Latch until the next queue emission so a double click cannot send two POSTs
    // before the server has broadcast the queued entry. A rejected POST clears the
    // latch through the settle callback instead — the queue only emits on server
    // activity, so a failed start would otherwise leave the button disabled until
    // some unrelated task touched the queue.
    this.calibrationRequested = true;
    this.tasksService.startAction(CALIBRATION_TASK_ID, undefined, err => {
      if (err) {
        this.calibrationRequested = false;
      }
    });
  }

  public thresholdsUpdated(): number {
    const run = this.calibrationRun();
    if (!run) {
      return 0;
    }
    return Object.values(run.perTag).filter(result => typeof result.threshold === 'number').length;
  }

  public attentionRows(): AutotagRow[] {
    return this.rows().filter(row => row.status === 'Review (low support)' || row.status === 'Not calibrated');
  }

  public attentionSummary(): string {
    const rows = this.attentionRows();
    const listed = rows
      .slice(0, ATTENTION_PREVIEW_LIMIT)
      .map(row => `${row.tag} — ${row.status === 'Review (low support)' ? 'low support' : 'not calibrated'}`);
    if (rows.length > ATTENTION_PREVIEW_LIMIT) {
      listed.push(`and ${rows.length - ATTENTION_PREVIEW_LIMIT} more`);
    }
    return listed.join(', ');
  }

  public applyModes(): TaskArgDefinitionSelectValue[] {
    const arg = (this.applyTask()?.args ?? []).find(candidate => candidate.type === 'select');
    return arg && arg.type === 'select' ? arg.values : [];
  }

  // Apply Tags is disabled when the selected model's task is missing from the
  // server's task list; the template explains that instead of leaving a dead
  // control (a build without the model's task, or a server mismatch).
  public applyTaskAvailable(): boolean {
    return this.applyTask() !== undefined;
  }

  public applyTaskId(): string {
    return APPLY_TASK_IDS[this.selectedModel];
  }

  public onApplyModeChange(value: string): void {
    this.applyMode = value;
  }

  // Mirrors the calibration status: an auto-tag run for the selected model that
  // is still queued or running disables the Apply button, so a double click
  // cannot queue the same job twice.
  public applyInFlight(): boolean {
    const taskId = APPLY_TASK_IDS[this.selectedModel];
    return (this.queue ?? []).some(task => task.type === taskId && !task.complete);
  }

  public async applyTags(): Promise<void> {
    const task = this.applyTask();
    if (!task) {
      return;
    }
    // Mirrors config.component.ts's startAction: a select value may require an
    // explicit confirmation ('replace' overwrites existing auto-generated
    // tags), so check the selected value before starting the task.
    for (const definition of task.args ?? []) {
      if (definition.type !== 'select') {
        continue;
      }
      const selected = definition.values.find(value => value.id === this.applyMode);
      if (selected?.confirm) {
        const confirmed = await this.confirmationService.confirm(selected.confirm);
        if (!confirmed) {
          return;
        }
      }
    }
    this.tasksService.startAction(task.id, [this.applyMode]);
  }

  private loadLastRun(): void {
    // One-shot read: the subscription completes on its own, so it is not pushed
    // into this.subscriptions (that list exists to tear down the long-lived
    // service streams in ngOnDestroy).
    const request = ++this.loadRunToken;
    this.tasksService.getTaskState<Autotag.CalibrationRun>(CALIBRATION_TASK_ID, 'last-run').subscribe(run => {
      // Two quick queue transitions fire overlapping GETs; the slower earlier
      // response must not overwrite the newer run.
      if (request === this.loadRunToken) {
        this.lastRun = run;
      }
    });
  }

  // Derives calibrationFailure from the changes in a queue snapshot: a new
  // queued/running attempt clears an older failure, a run completing with an
  // error raises it, and an entry leaving the queue (a successful run is spliced
  // by task-manager.ts, as is a cancelled queued entry) clears it. Unchanged
  // entries are skipped, so an older failed entry still sitting in the queue
  // never re-raises its error after a newer run succeeded.
  private syncCalibrationFailure(entries: QueuedTask[]): void {
    const states = new Map<string, string>();
    for (const entry of entries) {
      const state = `${entry.complete}:${entry.running}:${entry.aborted}:${entry.error ?? ''}`;
      states.set(entry.id, state);
      if (this.calibrationSnapshotSeen && this.calibrationEntryStates.get(entry.id) === state) {
        continue;
      }
      if (!entry.complete) {
        this.calibrationFailure = undefined;
      } else if (entry.aborted) {
        // An abort is a user action, not a failed run; the failure it replaced
        // was already cleared when the run was queued.
        continue;
      } else if (entry.error !== undefined) {
        this.calibrationFailure = entry.error;
      } else {
        // A completed run without an error supersedes an earlier failure; with
        // auto-clear off the successful entry stays in the queue, so it is
        // still the outcome to show.
        this.calibrationFailure = undefined;
      }
    }
    for (const id of this.calibrationEntryStates.keys()) {
      if (!states.has(id)) {
        this.calibrationFailure = undefined;
      }
    }
    this.calibrationEntryStates = states;
    // The first snapshot seeds the failure state, so a run that already failed
    // before the page loaded still reads as Failed.
    this.calibrationSnapshotSeen = true;
  }

  private applyTask(): ListedTask | undefined {
    const taskId = APPLY_TASK_IDS[this.selectedModel];
    return this.tasks?.find(task => task.id === taskId);
  }

  private descriptionsFor(tag: string): string[] {
    let descriptions = this.descriptions[tag];
    if (descriptions === undefined) {
      // Seeded once from the config entry; local edits then own the array until
      // they are persisted, so an unrelated config write cannot clobber
      // in-progress text.
      descriptions = [...(this.config?.autotags?.tags?.[tag]?.descriptions ?? [])];
      this.descriptions[tag] = descriptions;
    }
    return descriptions;
  }

  private saveTagConfig(tag: string, entry: Configuration.AutoTagTag): void {
    this.configService.updateConfiguration({ autotags: { tags: { [tag]: entry } } });
  }
}
