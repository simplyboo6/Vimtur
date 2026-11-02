import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { FaIconComponent } from '@fortawesome/angular-fontawesome';
import { faCircleXmark } from '@fortawesome/free-regular-svg-icons';
import { Autotag, Configuration, ListedTask, QueuedTask, TaskArgDefinitionSelect, TaskArgDefinitionSelectValue } from '@vimtur/common';
import { Subscription } from 'rxjs';
import { AlertService } from 'services/alert.service';
import { ConfigService } from 'services/config.service';
import { ConfirmationService } from 'services/confirmation.service';
import { TagService } from 'services/tag.service';
import { TasksService } from 'services/tasks.service';
import { LoadingComponent } from '../loading/loading.component';

// The page's zero-shot apply task. The server builds the id as
// `AUTO-TAG-${AVES_SIGLIP2_B32.id}` (server/src/tasks/autotag/siglip/state.ts
// exports it as AUTO_TAG_TASK_ID); it is fixed here because calibration and its
// stored run are SigLIP-2-only features. The model selected on this page also
// drives import-time auto-tagging (AUTO-IMPORT): with this task selected and no
// tag holding an applicable threshold, the server skips tagging during import
// and the import continues.
const SIGLIP_APPLY_TASK_ID = 'AUTO-TAG-AVES-SIGLIP2-B32';

// Roster label for SIGLIP_APPLY_TASK_ID only: the server task description
// carries the full pack name for the roster select, while this page uses
// shorter suggested-default wording (the "selective int8"/"256px" phrasing
// comes from the pack's RELEASE name, not from AVES_SIGLIP2_B32.name). The id's
// source of truth is AUTO_TAG_TASK_ID in
// server/src/tasks/autotag/siglip/state.ts.
const SIGLIP_APPLY_TASK_LABEL = 'SigLIP-2 (selective int8, 256px) — recommended';

// Model pack the calibration run records. Thresholds from another pack's
// embedding space are meaningless here, so a mismatched run is stale evidence
// and is ignored (see calibrationRun).
const AUTOTAG_MODEL_ID = 'AVES-SIGLIP2-B32';

const CALIBRATION_TASK_ID = 'CALIBRATE-SIGLIP2-B32';

// Bulk maintenance task: clears generated tags from every media item that holds
// an auto-tags list. It is the server-side counterpart of the viewer's × icon
// and runs as a normal task, so its in-flight state is read from the raw queue
// snapshot.
const CLEAR_TAGGED_AUTOTAGS_TASK_ID = 'CLEAR-TAGGED-AUTOTAGS';

// First value of the second apply select (and its server-side default): media
// the user has already tagged manually is left alone unless include-tagged is
// chosen.
const TAG_MODE_SKIP_TAGGED = 'skip-tagged';

// Every listed task with this prefix is an apply model the roster offers, with
// the task's description (the same string the General tab's task dropdown
// shows) as its label. `autotags.model` stores the chosen task id, so the roster
// is derived at render time instead of duplicated here.
const APPLY_TASK_PREFIX = 'AUTO-TAG-';

// 'skip-existing' is the server-side default; 'replace' carries a confirmation
// message in its ListedTask argument definition (see config.component.ts's
// startAction for the general task-argument pattern).
const MODE_SKIP_EXISTING = 'skip-existing';

// The attention sentence lists at most this many tags before collapsing the
// rest into "and N more"; an untagged library can flag every tag at once.
const ATTENTION_PREVIEW_LIMIT = 5;

// A not-calibrated row's threshold field shows this as a placeholder: a suggested
// starting point for SigLIP-2 cosine cuts (real-encoder verification observed best-F1
// cuts around 0.08–0.09, so this errs just above the natural cut toward precision).
// It is a hint only: nothing is stored or auto-applied until the user types a value
// and blurs, at which point the row reads "Manually overridden".
const SUGGESTED_THRESHOLD_PLACEHOLDER = '0.1';

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
  'Not calibrated': `missing a calibrated threshold: it needs tagged examples and a calibration run; a threshold you type yourself is applied as-is. Only tags with an Auto-Tagging entry here are scored and calibrated. The ${SUGGESTED_THRESHOLD_PLACEHOLDER} placeholder is only a suggested starting point and is never applied on its own.`,
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

// Failure lifecycle state for one task type (a queue entry's `type`). One track
// per kind the page shows a status for: the calibration task and whichever
// apply task is selected.
interface FailureTrack {
  // Error of the latest failed run, raised and cleared by syncFailure;
  // undefined when no failure is the current outcome.
  failure?: string;
  // Per-entry `complete:running:aborted:error` seen in the previous queue
  // snapshot, keyed by queue id (see syncFailure).
  entryStates: Map<string, string>;
  // False until the first snapshot seeds the track, so a run that failed before
  // the page loaded still reads as Failed.
  snapshotSeen: boolean;
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
  public readonly suggestedThresholdPlaceholder = SUGGESTED_THRESHOLD_PLACEHOLDER;
  public readonly statusBadgeClasses = STATUS_BADGE_CLASSES;
  public readonly statusLegend: ReadonlyArray<{ status: Autotag.TagStatus; description: string }> = (
    Object.entries(STATUS_LEGEND) as [Autotag.TagStatus, string][]
  ).map(([status, description]) => ({ status, description }));

  public config?: Configuration.Main;
  public tags?: string[];
  public addTagModel?: string;
  public applyMode = MODE_SKIP_EXISTING;
  // The second select's choice; undefined until the user picks one so the
  // binding falls back to the task's first value (skip-tagged).
  private taggedMode?: string;
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
  // Failure lifecycle state per task type; see syncFailure. One track is kept
  // for the calibration task and one for the selected apply task. A failure is
  // held explicitly instead of read off the queue tail: the server splices a
  // successful entry out of the queue (task-manager.ts auto-clears a completed
  // run via cancel → splice) while a failed entry stays behind with
  // complete: true and its error. After a failure followed by a success the
  // tail is the OLD failed entry again, so a tail lookup reported "Failed"
  // while Last Run said Complete.
  private readonly failureTracks = new Map<string, FailureTrack>();
  // Apply task id whose failure track is live. The id changes with the model
  // selection, so a stale track is dropped on the change rather than left to
  // colour the new selection's status (see clearPreviousApplyFailure).
  private applyFailureTaskId?: string;
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
      this.configService.getConfiguration().subscribe(
        config => {
          this.config = config;
          // The apply status is keyed by the selected task id: drop the previous
          // selection's failure as soon as the id changes, so it can never show
          // under the new selection between the write and the next queue
          // emission (see clearPreviousApplyFailure).
          this.clearPreviousApplyFailure();
          // Re-seed from the current queue: a config write emits no queue
          // snapshot, so without this a newly selected task whose run already
          // errored would read as Idle until the queue next changes.
          // syncFailure skips unchanged entries, so this is idempotent for a
          // track already in step.
          this.syncFailure(this.applyTaskId(), this.applyEntries());
        },
        // ConfigService already alerts on a failed fetch; a stream error here
        // (the replay subject never errors in practice) only leaves the page on
        // its loading state, so the console is enough.
        (err: HttpErrorResponse) => console.warn('Failed to load the Auto-Tagging configuration', err),
      ),
    );

    this.subscriptions.push(
      this.tagService.getTags().subscribe(
        tags => {
          this.tags = tags;
        },
        (err: HttpErrorResponse) => console.warn('Failed to load tags', err),
      ),
    );

    this.subscriptions.push(
      this.tasksService.getTasks().subscribe(
        tasks => {
          this.tasks = tasks;
        },
        (err: HttpErrorResponse) => console.warn('Failed to load the task list', err),
      ),
    );

    this.subscriptions.push(
      this.tasksService.getQueue().subscribe(
        queue => {
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
          this.syncFailure(CALIBRATION_TASK_ID, entries);
          // Apply runs share the lifecycle but track the selected task id only.
          // The selected id lives in the config, and a queue snapshot can arrive
          // before the config GET resolves (the queue is replayed from the
          // service), so the apply track is seeded by the config subscription
          // until the config is available.
          if (this.config) {
            this.clearPreviousApplyFailure();
            this.syncFailure(this.applyTaskId(), this.applyEntries());
          }
        },
        // The queue is also replayed from the service's own HTTP read and kept
        // live by the socket; a failure here is a connectivity problem with no
        // user action to recover, so the console is right.
        (err: HttpErrorResponse) => console.warn('Failed to load the task queue', err),
      ),
    );

    this.loadLastRun();
  }

  public ngOnDestroy(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  // Auto-Tagging settings are always present in a server config response (the
  // server fills them from its own DEFAULTS), so this page reads them directly
  // and throws rather than inventing client-side fallbacks that could drift
  // from the server. The template only renders the page once the config GET has
  // resolved, so reaching this throw means a genuine wiring bug rather than a
  // normal startup state.
  private get autotags(): Configuration.AutoTags {
    if (!this.config?.autotags) {
      throw new Error('Auto-Tagging settings not loaded from the server yet');
    }
    return this.config.autotags;
  }

  // The stored model id comes from the server config, whose own default is
  // SIGLIP_APPLY_TASK_ID (see server/src/config.ts DEFAULTS); there is no
  // client-side fallback to drift from it.
  public get selectedModel(): string {
    return this.autotags.model;
  }

  // The model select's roster: every apply task the server lists, labelled by
  // its own description (the classifier descriptions already carry the model
  // name; SigLIP-2 gets the page's suggested-default label). The stored id is
  // appended when the server does not list it, so a config write cannot
  // silently snap the user onto a different model — the apply-unavailable
  // alert explains it instead.
  public modelOptions(): Array<{ id: string; label: string }> {
    const options = (this.tasks ?? [])
      .filter(task => task.id.startsWith(APPLY_TASK_PREFIX))
      .map(task => ({ id: task.id, label: task.id === SIGLIP_APPLY_TASK_ID ? SIGLIP_APPLY_TASK_LABEL : task.description }));
    const selected = this.selectedModel;
    if (!options.some(option => option.id === selected)) {
      options.unshift({ id: selected, label: `${selected} (not listed by this server)` });
    }
    return options;
  }

  public selectedModelLabel(): string {
    return this.modelOptions().find(option => option.id === this.selectedModel)?.label ?? this.selectedModel;
  }

  // The model field stores the id of the apply task Apply runs and, on the
  // server, of the auto-tag task AUTO-IMPORT uses. Everything else on this page
  // (tag table, statuses, calibration) is SigLIP-2-only, so the template
  // disables those controls rather than hiding the state they describe. An id
  // the server does not list is treated as non-siglip (fail closed).
  public get isSiglipSelected(): boolean {
    return this.selectedModel === SIGLIP_APPLY_TASK_ID;
  }

  public get workerCount(): number {
    return this.autotags.workers;
  }

  public get minSupport(): number {
    return this.autotags.minSupport;
  }

  public get calibrationSampleSize(): number {
    return this.autotags.calibrationSampleSize;
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
    const manual = this.autotags.tags?.[tag]?.manualThreshold;
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
    const manual = this.autotags.tags?.[tag]?.manualThreshold;
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

  // Encoded because a tag can contain spaces or quotes, which would break the
  // attribute selector used to find the input again after adding a row.
  public descriptionInputDataId(tag: string, index: number): string {
    return `autotag-desc-${encodeURIComponent(tag)}-${index}`;
  }

  public addDescription(tag: string): void {
    const descriptions = this.descriptionsFor(tag);
    descriptions.push('');
    this.persistDescriptions(tag);
    // The new row only exists after the change-detection pass that follows this
    // click, so the focus has to wait for the render.
    const dataId = this.descriptionInputDataId(tag, descriptions.length - 1);
    setTimeout(() => document.querySelector<HTMLInputElement>(`[data-id="${dataId}"]`)?.focus(), 0);
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

  public saveModel(model: string): void {
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
        // A genuinely new tag starts with the default description row seeded and
        // persisted immediately, so the entry exists and the row opens with an
        // editable default. An already-configured entry keeps its stored
        // descriptions, which the next replay would otherwise have replaced.
        // The wording ("a photo showing", not the server's implicit
        // "a photo of") is a deliberate user-requested default, so the row is
        // an additional scored prompt next to the two implicit ones.
        if (this.autotags.tags?.[tag] === undefined) {
          this.descriptions[tag] = [`a photo showing ${tag}`];
          this.persistDescriptions(tag);
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
      .confirm(
        // The tag row here sits next to Auto-Tagging settings, so the prompt has
        // to say the delete is library-wide. Both backends cascade the delete to
        // the media/tag links (SQLite media_tags FK ON DELETE CASCADE; MongoDB
        // removeTag pulls the tag from every media document). The Auto-Tagging
        // config entry is not deleted client-side: the server purges entries
        // without a DB tag at the next calibration run.
        `Are you sure you want to delete '${tag}'? This deletes the tag everywhere — off every media it is attached to. Its Auto-Tagging descriptions and thresholds remain until the next calibration run clears them.`,
        true,
      )
      .then(result => {
        if (result) {
          this.tagService.deleteTag(tag);
          delete this.descriptions[tag];
        }
      });
  }

  public calibrationStatus(): string {
    const entries = (this.queue ?? []).filter(task => task.type === CALIBRATION_TASK_ID);
    return this.taskStatus(entries, this.failureFor(CALIBRATION_TASK_ID));
  }

  // Same precedence for the apply task the selected model runs: running beats
  // queued beats a recorded failure, and Idle is the no-run state.
  public applyStatus(): string {
    return this.taskStatus(this.applyEntries(), this.failureFor(this.applyTaskId()));
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
    // A tag without an autotags.tags entry is not opted in: it is never scored
    // or calibrated, so it cannot be failing a calibration it is not part of.
    // It stays in the table (the description column is how it is opted in).
    return this.rows().filter(row => this.autotags.tags?.[row.tag] !== undefined && (row.status === 'Review (low support)' || row.status === 'Not calibrated'));
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

  // Both apply selects derive from the selected task's arguments, so the
  // classifier and SigLIP-2 families (which declare identical shapes) need no
  // per-model wiring here.
  private applySelects(): TaskArgDefinitionSelect[] {
    return (this.applyTask()?.args ?? []).filter((candidate): candidate is TaskArgDefinitionSelect => candidate.type === 'select');
  }

  public applyModes(): TaskArgDefinitionSelectValue[] {
    return this.applySelects()[0]?.values ?? [];
  }

  // Second select: whether media that already carries manual tags may be
  // tagged. It falls back to the task's first value (skip-tagged) so the page
  // and the server runner cannot drift on the default.
  public applyTaggedModes(): TaskArgDefinitionSelectValue[] {
    return this.applySelects()[1]?.values ?? [];
  }

  public get applyTaggedMode(): string {
    return this.taggedMode ?? this.applyTaggedModes()[0]?.id ?? TAG_MODE_SKIP_TAGGED;
  }

  // Apply Tags is disabled when the selected model's task is missing from the
  // server's task list; the template explains that instead of leaving a dead
  // control (a build without the model's task, or a server mismatch).
  public applyTaskAvailable(): boolean {
    return this.applyTask() !== undefined;
  }

  public applyTaskId(): string {
    return this.selectedModel;
  }

  public onApplyModeChange(value: string): void {
    this.applyMode = value;
  }

  public onApplyTaggedModeChange(value: string): void {
    this.taggedMode = value;
  }

  // Mirrors the calibration status: an auto-tag run for the selected model that
  // is still queued or running disables the Apply button, so a double click
  // cannot queue the same job twice.
  public applyInFlight(): boolean {
    return (this.queue ?? []).some(task => task.type === this.applyTaskId() && !task.complete);
  }

  // The maintenance task is a plain one-shot run and deliberately does not get
  // the calibration/apply failure tracks: a raw queue-snapshot in-flight check
  // is enough to keep the button disabled while its entry is queued or running
  // (YAGNI for anything richer).
  public clearTaggedAutoTagsInFlight(): boolean {
    return (this.queue ?? []).some(task => task.type === CLEAR_TAGGED_AUTOTAGS_TASK_ID && !task.complete);
  }

  public clearTaggedAutoTags(): void {
    if (this.clearTaggedAutoTagsInFlight()) {
      return;
    }
    this.confirmationService.confirm('This removes auto-generated tags from every media item.').then(confirmed => {
      if (confirmed) {
        this.tasksService.startAction(CLEAR_TAGGED_AUTOTAGS_TASK_ID);
      }
    });
  }

  public async applyTags(): Promise<void> {
    const task = this.applyTask();
    if (!task) {
      return;
    }
    // Both selects are carried positionally in the task's args (the first is
    // the existing-tags mode, the second the manual-tagged mode), so each
    // choice's confirmation is checked against its own value.
    const selectValues = [this.applyMode, this.applyTaggedMode];
    const selections = this.applySelects().map((definition, index) => definition.values.find(value => value.id === selectValues[index]));
    // Mirrors config.component.ts's startAction: a select value may require an
    // explicit confirmation ('replace' / 'include-tagged'), so check every
    // selected value before starting the task.
    for (const selected of selections) {
      if (selected?.confirm) {
        const confirmed = await this.confirmationService.confirm(selected.confirm);
        if (!confirmed) {
          return;
        }
      }
    }
    this.tasksService.startAction(task.id, selectValues.slice(0, selections.length));
  }

  private loadLastRun(): void {
    // One-shot read: the subscription completes on its own, so it is not pushed
    // into this.subscriptions (that list exists to tear down the long-lived
    // service streams in ngOnDestroy).
    const request = ++this.loadRunToken;
    this.tasksService.getTaskState<Autotag.CalibrationRun>(CALIBRATION_TASK_ID, 'last-run').subscribe(
      run => {
        // Two quick queue transitions fire overlapping GETs; the slower earlier
        // response must not overwrite the newer run.
        if (request === this.loadRunToken) {
          this.lastRun = run;
        }
      },
      // A failed read only leaves the Last Run section showing its previous
      // value and the next queue transition refetches, so a console warning is
      // enough; there is no user action to recover here.
      (err: HttpErrorResponse) => console.warn('Failed to load the last calibration run', err),
    );
  }

  // Derives a task type's failure from the changes in a queue snapshot: a new
  // queued/running attempt clears an older failure, a run completing with an
  // error raises it, and an entry leaving the queue (a successful run is spliced
  // by task-manager.ts, as is a cancelled queued entry) clears it. Unchanged
  // entries are skipped, so an older failed entry still sitting in the queue
  // never re-raises its error after a newer run succeeded. Queue ids reuse freed
  // slots (task-manager.ts allocates the lowest free suffix), so only an entry's
  // own state is compared, never its position.
  private syncFailure(taskId: string, entries: QueuedTask[]): void {
    const track = this.failureTrack(taskId);
    const states = new Map<string, string>();
    for (const entry of entries) {
      const state = `${entry.complete}:${entry.running}:${entry.aborted}:${entry.error ?? ''}`;
      states.set(entry.id, state);
      if (track.snapshotSeen && track.entryStates.get(entry.id) === state) {
        continue;
      }
      if (!entry.complete) {
        track.failure = undefined;
      } else if (entry.aborted) {
        // An abort is a user action, not a failed run; the failure it replaced
        // was already cleared when the run was queued.
        continue;
      } else if (entry.error !== undefined) {
        track.failure = entry.error;
      } else {
        // A completed run without an error supersedes an earlier failure; with
        // auto-clear off the successful entry stays in the queue, so it is
        // still the outcome to show.
        track.failure = undefined;
      }
    }
    for (const id of track.entryStates.keys()) {
      if (!states.has(id)) {
        track.failure = undefined;
      }
    }
    track.entryStates = states;
    // The first snapshot seeds the failure state, so a run that already failed
    // before the page loaded still reads as Failed.
    track.snapshotSeen = true;
  }

  private failureTrack(taskId: string): FailureTrack {
    let track = this.failureTracks.get(taskId);
    if (track === undefined) {
      track = { entryStates: new Map<string, string>(), snapshotSeen: false };
      this.failureTracks.set(taskId, track);
    }
    return track;
  }

  private failureFor(taskId: string): string | undefined {
    return this.failureTracks.get(taskId)?.failure;
  }

  // The apply status is keyed by the selected task id. When the selection
  // changes, the previous id's track is dropped: that failure belongs to a task
  // the page no longer shows, and the new id starts unseeded, so the next queue
  // snapshot re-seeds it (an already-failed run of the newly selected task then
  // still reads as Failed). Calibration keeps its own track untouched.
  private clearPreviousApplyFailure(): void {
    const taskId = this.applyTaskId();
    if (
      this.applyFailureTaskId !== undefined &&
      this.applyFailureTaskId !== taskId &&
      // Calibration owns its own track; never let a hand-edited
      // autotags.model equal to the calibration id drop it.
      this.applyFailureTaskId !== CALIBRATION_TASK_ID
    ) {
      this.failureTracks.delete(this.applyFailureTaskId);
    }
    this.applyFailureTaskId = taskId;
  }

  // The selected apply task's queue entries, the snapshot every apply-status
  // read and re-seed derives from.
  private applyEntries(): QueuedTask[] {
    return (this.queue ?? []).filter(task => task.type === this.applyTaskId());
  }

  private taskStatus(entries: QueuedTask[], failure: string | undefined): string {
    const running = entries.find(task => task.running);
    if (running) {
      return `Running — ${running.current}/${running.max} …`;
    }
    if (entries.some(task => !task.complete)) {
      return 'Queued — waiting for a worker slot.';
    }
    // Failures come from the synced track rather than a queue tail lookup; see
    // the failureTracks field comment.
    if (failure !== undefined) {
      return `Failed — ${failure}`;
    }
    return 'Idle — not currently running.';
  }

  private applyTask(): ListedTask | undefined {
    const taskId = this.applyTaskId();
    return this.tasks?.find(task => task.id === taskId);
  }

  private descriptionsFor(tag: string): string[] {
    let descriptions = this.descriptions[tag];
    if (descriptions === undefined) {
      // Seeded once from the config entry; local edits then own the array until
      // they are persisted, so an unrelated config write cannot clobber
      // in-progress text.
      descriptions = [...(this.autotags.tags?.[tag]?.descriptions ?? [])];
      this.descriptions[tag] = descriptions;
    }
    return descriptions;
  }

  private saveTagConfig(tag: string, entry: Configuration.AutoTagMetadata): void {
    this.configService.updateConfiguration({ autotags: { tags: { [tag]: entry } } });
  }
}
