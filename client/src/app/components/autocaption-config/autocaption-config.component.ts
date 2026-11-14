import { ChangeDetectionStrategy, Component, OnDestroy, OnInit } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { Configuration, ListedTask, QueuedTask, TaskArgDefinitionSelect, TaskArgDefinitionSelectValue } from '@vimtur/common';
import { Subscription } from 'rxjs';
import { TaskStatusTracker } from 'app/shared/task-status';
import { ConfigService } from 'services/config.service';
import { ConfirmationService } from 'services/confirmation.service';
import { TasksService } from 'services/tasks.service';
import { LoadingComponent } from '../loading/loading.component';

// Every listed task with this prefix is an apply model the roster offers, with
// the task's description (the same string the General tab's task dropdown
// shows) as its label. Unlike the Auto-Tagging page's fixed SigLIP-2 apply id,
// no single AUTO-CAPTION-* id is special: every listed one is a valid apply
// task, and `autocaption.model` stores the chosen task id, so the roster is
// derived at render time instead of duplicated here.
const APPLY_TASK_PREFIX = 'AUTO-CAPTION-';

// Bulk maintenance task: removes generated captions from every media item that
// holds one. It runs as a normal task, so its in-flight state and failure are
// read from the raw queue snapshot.
const CLEAR_AUTOCAPTIONS_TASK_ID = 'CLEAR-AUTOCAPTIONS';

// 'skip-existing' is the server-side default (an omitted argument captions only
// media without a generated caption); 'replace' carries a confirmation message
// in its ListedTask argument definition.
const MODE_SKIP_EXISTING = 'skip-existing';

// Mirrors the @minimum/@maximum bounds on Configuration.AutoCaption in
// common/src/config.d.ts; the server bounds them again, but clamping here keeps
// an out-of-range keystroke from producing a rejected save alert.
const WORKER_COUNT_MIN = 1;
const WORKER_COUNT_MAX = 8;
const MAX_TOKENS_MIN = 1;
const MAX_TOKENS_MAX = 100;

@Component({
  selector: 'app-autocaption-config',
  templateUrl: './autocaption-config.component.html',
  styleUrls: ['./autocaption-config.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [FormsModule, LoadingComponent],
})
export class AutocaptionConfigComponent implements OnInit, OnDestroy {
  public config?: Configuration.Main;
  public applyMode = MODE_SKIP_EXISTING;

  // The second select's choice; undefined until the user picks one so the
  // binding falls back to the task's first value (skip-tagged).
  private taggedMode?: string;
  private tasks?: ListedTask[];
  private queue?: QueuedTask[];
  // Status and failure state for the selected apply task and the clear task; see
  // TaskStatusTracker. Status is derived from the queue snapshots and this track
  // rather than stored on the entry, so a later success clears an older failure
  // and vice versa.
  private readonly statusTracker = new TaskStatusTracker();
  // Apply task id whose failure track is live. The id changes with the model
  // selection, so a stale track is dropped on the change rather than left to
  // colour the new selection's status (see clearPreviousApplyFailure).
  private applyFailureTaskId?: string;
  // Set as the first thing each handler does, before its confirmation dialog,
  // and cleared by the next queue emission. Latching before the dialog is what
  // stops a double click opening two dialogs; the queue emission then re-syncs
  // with reality once the server broadcasts the new entry. A declined
  // confirmation, a rejected start request (see the settle callback) or a
  // missing task all release the latch, so the button cannot stay disabled.
  private applyRequested = false;
  // Same latch for the Clear handler's confirmation and POST.
  private clearRequested = false;
  private subscriptions: Subscription[] = [];

  private configService: ConfigService;
  private tasksService: TasksService;
  private confirmationService: ConfirmationService;

  public constructor(configService: ConfigService, tasksService: TasksService, confirmationService: ConfirmationService) {
    this.configService = configService;
    this.tasksService = tasksService;
    this.confirmationService = confirmationService;
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
          this.statusTracker.sync(this.applyTaskId(), this.applyEntries());
        },
        // ConfigService already alerts on a failed fetch; a stream error here
        // only leaves the page on its loading state, so the console is enough.
        (err: HttpErrorResponse) => console.warn('Failed to load the Auto-Captioning configuration', err),
      ),
    );

    this.subscriptions.push(
      this.tasksService.getTasks().subscribe(
        tasks => {
          this.tasks = tasks;
          // The fallback selection (the first listed task) depends on the
          // roster, so re-seed the apply track once the list arrives.
          if (this.config) {
            this.clearPreviousApplyFailure();
            this.statusTracker.sync(this.applyTaskId(), this.applyEntries());
          }
        },
        (err: HttpErrorResponse) => console.warn('Failed to load the task list', err),
      ),
    );

    this.subscriptions.push(
      this.tasksService.getQueue().subscribe(
        queue => {
          this.queue = queue;
          // Any emission re-syncs the click latches: they cover the confirmation
          // dialog and the gap until the server broadcasts the new entry (see
          // applyRequested).
          this.applyRequested = false;
          this.clearRequested = false;
          this.statusTracker.sync(CLEAR_AUTOCAPTIONS_TASK_ID, this.clearEntries());
          // The selected id lives in the config and a queue snapshot can arrive
          // before the config GET resolves, so the apply track is seeded by the
          // config subscription until the config is available.
          if (this.config) {
            this.clearPreviousApplyFailure();
            this.statusTracker.sync(this.applyTaskId(), this.applyEntries());
          }
        },
        // The queue is replayed from the service's own HTTP read and kept live
        // by the socket; a failure here is a connectivity problem with no user
        // action to recover, so the console is right.
        (err: HttpErrorResponse) => console.warn('Failed to load the task queue', err),
      ),
    );
  }

  public ngOnDestroy(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.subscriptions = [];
  }

  // Auto-Captioning settings are always present in a server config response
  // (the server fills them from its own DEFAULTS), so this page reads them
  // directly and throws rather than inventing client-side fallbacks that could
  // drift from the server. The template only renders the page once the config
  // GET has resolved, so reaching this throw means a genuine wiring bug rather
  // than a normal startup state.
  private get autocaption(): Configuration.AutoCaption {
    if (!this.config?.autocaption) {
      throw new Error('Auto-Captioning settings not loaded from the server yet');
    }
    return this.config.autocaption;
  }

  // The stored id comes from the server config; before the config resolves the
  // roster's first entry is the same fallback the server uses.
  public get selectedModel(): string {
    return this.config?.autocaption?.model ?? this.modelOptions()[0]?.id ?? '';
  }

  // The model select's roster: every apply task the server lists, labelled by
  // its own description (which already carries the model name). The stored id is
  // prepended when the server does not list it, so the control shows what is
  // stored instead of silently snapping the user onto a different model — the
  // apply-unavailable alert explains it instead. Read from the config rather
  // than selectedModel: that getter falls back to this list, so it would recurse.
  public modelOptions(): Array<{ id: string; label: string }> {
    const options = (this.tasks ?? []).filter(task => task.id.startsWith(APPLY_TASK_PREFIX)).map(task => ({ id: task.id, label: task.description }));
    const selected = this.config?.autocaption?.model;
    if (selected !== undefined && !options.some(option => option.id === selected)) {
      options.unshift({ id: selected, label: `${selected} (not listed by this server)` });
    }
    return options;
  }

  public get workerCount(): number {
    return this.autocaption.workers;
  }

  public get maxTokens(): number {
    return this.autocaption.maxTokens;
  }

  public saveModel(model: string): void {
    this.configService.updateConfiguration({ autocaption: { model } });
  }

  // The number settings persist on the input's `change` event (blur or Enter)
  // rather than per keystroke: intermediate values are wasted writes. The
  // handler reads `.valueAsNumber` from a template reference, which is NaN for
  // an empty field and ignored so the user can correct it; the rest is clamped
  // to the schema bounds before posting.
  public saveWorkerCount(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }
    const workers = Math.min(WORKER_COUNT_MAX, Math.max(WORKER_COUNT_MIN, value));
    this.configService.updateConfiguration({ autocaption: { workers } });
  }

  public saveMaxTokens(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }
    const maxTokens = Math.min(MAX_TOKENS_MAX, Math.max(MAX_TOKENS_MIN, value));
    this.configService.updateConfiguration({ autocaption: { maxTokens } });
  }

  // Same precedence for the apply task the selected model runs: running beats
  // queued beats a recorded failure, and Idle is the no-run state.
  public applyStatus(): string {
    return this.statusTracker.status(this.applyTaskId(), this.applyEntries(), this.tasks);
  }

  public clearStatus(): string {
    return this.statusTracker.status(CLEAR_AUTOCAPTIONS_TASK_ID, this.clearEntries(), this.tasks);
  }

  // An apply run for the selected model that is still queued or running (or just
  // requested) disables the Apply button, so a double click cannot queue the same
  // job twice.
  public applyInFlight(): boolean {
    if (this.applyRequested) {
      return true;
    }
    return (this.queue ?? []).some(task => task.type === this.applyTaskId() && !task.complete);
  }

  public clearInFlight(): boolean {
    if (this.clearRequested) {
      return true;
    }
    return (this.queue ?? []).some(task => task.type === CLEAR_AUTOCAPTIONS_TASK_ID && !task.complete);
  }

  // Apply Captions is disabled when the selected model's task is missing from
  // the server's task list; the template explains that instead of leaving a
  // dead control (a build without the model's task, or a server mismatch).
  public applyTaskAvailable(): boolean {
    return this.applyTask() !== undefined;
  }

  public applyTaskId(): string {
    return this.selectedModel;
  }

  // Both apply selects derive from the selected task's arguments, so any
  // caption family that declares the same two select shapes needs no
  // per-model wiring here.
  private applySelects(): TaskArgDefinitionSelect[] {
    return (this.applyTask()?.args ?? []).filter((candidate): candidate is TaskArgDefinitionSelect => candidate.type === 'select');
  }

  public applyModes(): TaskArgDefinitionSelectValue[] {
    return this.applySelects()[0]?.values ?? [];
  }

  // Second select: whether media that already carries manual tags may be
  // captioned. It falls back to the task's first value (skip-tagged) so the
  // page and the server runner cannot drift on the default.
  public applyTaggedModes(): TaskArgDefinitionSelectValue[] {
    return this.applySelects()[1]?.values ?? [];
  }

  public get applyTaggedMode(): string {
    return this.taggedMode ?? this.applyTaggedModes()[0]?.id ?? '';
  }

  public onApplyModeChange(value: string): void {
    this.applyMode = value;
  }

  public onApplyTaggedModeChange(value: string): void {
    this.taggedMode = value;
  }

  public async apply(): Promise<void> {
    if (this.applyInFlight()) {
      return;
    }
    const task = this.applyTask();
    if (!task) {
      return;
    }
    // Latch before the confirmation resolves: two clicks dispatched before the
    // dialog opens would otherwise both pass applyInFlight() and stack dialogs.
    // A declined confirmation or a rejected POST (see the settle callback)
    // releases it; a queue emission clears it.
    this.applyRequested = true;
    // Both selects are carried positionally in the task's args (the first is
    // the existing-captions mode, the second the manual-tagged mode), so each
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
          this.applyRequested = false;
          return;
        }
      }
    }
    this.tasksService.startAction(task.id, selectValues.slice(0, selections.length), err => {
      if (err) {
        this.applyRequested = false;
      }
    });
  }

  public clear(): void {
    if (this.clearInFlight()) {
      return;
    }
    // Latch before the confirmation for the same reason as apply().
    this.clearRequested = true;
    this.confirmationService.confirm('This removes generated captions from every media item.').then(confirmed => {
      if (!confirmed) {
        this.clearRequested = false;
        return;
      }
      this.tasksService.startAction(CLEAR_AUTOCAPTIONS_TASK_ID, undefined, err => {
        if (err) {
          this.clearRequested = false;
        }
      });
    });
  }

  // The apply status is keyed by the selected task id. When the selection
  // changes, the previous id's track is dropped: that failure belongs to a task
  // the page no longer shows, and the new id starts unseeded, so the next queue
  // snapshot re-seeds it (an already-failed run of the newly selected task then
  // still reads as Failed). The clear task keeps its own track untouched.
  private clearPreviousApplyFailure(): void {
    const taskId = this.applyTaskId();
    if (
      this.applyFailureTaskId !== undefined &&
      this.applyFailureTaskId !== taskId &&
      // The clear task owns its own track; never let a hand-edited
      // autocaption.model equal to the clear id drop it.
      this.applyFailureTaskId !== CLEAR_AUTOCAPTIONS_TASK_ID
    ) {
      this.statusTracker.forget(this.applyFailureTaskId);
    }
    this.applyFailureTaskId = taskId;
  }

  // The selected apply task's queue entries, the snapshot every apply-status
  // read and re-seed derives from.
  private applyEntries(): QueuedTask[] {
    return (this.queue ?? []).filter(task => task.type === this.applyTaskId());
  }

  private clearEntries(): QueuedTask[] {
    return (this.queue ?? []).filter(task => task.type === CLEAR_AUTOCAPTIONS_TASK_ID);
  }

  private applyTask(): ListedTask | undefined {
    const taskId = this.applyTaskId();
    return this.tasks?.find(task => task.id === taskId);
  }
}
