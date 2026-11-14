import { ListedTask, QueuedTask } from '@vimtur/common';

// Failure lifecycle state for one task type (a queue entry's `type`). One track
// per kind a page shows a status for, e.g. Auto-Tagging's calibration task plus
// whichever apply task is selected.
interface FailureTrack {
  // Error of the latest failed run, raised and cleared by sync; undefined when
  // no failure is the current outcome.
  failure?: string;
  // Per-entry `complete:running:aborted:error` seen in the previous queue
  // snapshot, keyed by queue id (see sync).
  entryStates: Map<string, string>;
  // False until the first snapshot seeds the track, so a run that failed before
  // the page loaded still reads as Failed.
  snapshotSeen: boolean;
}

// Status and failure state for the task-queue-driven pages (Auto-Tagging and
// Auto-Captioning). A failure is held explicitly instead of read off the queue
// tail: the server splices a successful entry out of the queue
// (task-manager.ts auto-clears a completed run via cancel → splice) while a
// failed entry stays behind with complete: true and its error. After a failure
// followed by a success the tail is the OLD failed entry again, so a tail lookup
// reported "Failed" while Last Run said Complete.
export class TaskStatusTracker {
  private readonly tracks = new Map<string, FailureTrack>();

  // Derives a task type's failure from the changes in a queue snapshot: a new
  // queued/running attempt clears an older failure, a run completing with an
  // error raises it, and an entry leaving the queue (a successful run is spliced
  // by task-manager.ts, as is a cancelled queued entry) clears it. Unchanged
  // entries are skipped, so an older failed entry still sitting in the queue
  // never re-raises its error after a newer run succeeded. Queue ids reuse freed
  // slots (task-manager.ts allocates the lowest free suffix), so only an entry's
  // own state is compared, never its position.
  public sync(taskId: string, entries: QueuedTask[]): void {
    const track = this.track(taskId);
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

  // Latest failed run for the task, cleared by a later run.
  public failure(taskId: string): string | undefined {
    return this.tracks.get(taskId)?.failure;
  }

  // Running beats queued beats a recorded failure, and Idle is the no-run state.
  public status(taskId: string, entries: QueuedTask[], tasks: ListedTask[] | undefined): string {
    const running = entries.find(task => task.running);
    if (running) {
      // A long run reports each phase through the queue entry's description and
      // the server restores the task's registered description on completion, so a
      // running entry whose description differs from the roster's is a phase label
      // rather than the task name. No listed task yet (the roster GET is still in
      // flight) leaves the registered description unknown, and progress alone is
      // safer than mistaking the task name for a phase.
      const registered = tasks?.find(task => task.id === taskId)?.description;
      if (registered !== undefined && running.description !== registered) {
        return `Running — ${running.description} (${running.current}/${running.max}) …`;
      }
      return `Running — ${running.current}/${running.max} …`;
    }
    if (entries.some(task => !task.complete)) {
      return 'Queued — waiting for a worker slot.';
    }
    // Failures come from the synced track rather than a queue tail lookup; see
    // the class comment.
    const failure = this.failure(taskId);
    if (failure !== undefined) {
      return `Failed — ${failure}`;
    }
    return 'Idle — not currently running.';
  }

  // Drops a task's track (e.g. the selected model changed): that failure belongs
  // to a task the page no longer shows, and the next sync seeds a fresh track, so
  // an already-failed run of a newly selected task still reads as Failed.
  public forget(taskId: string): void {
    this.tracks.delete(taskId);
  }

  private track(taskId: string): FailureTrack {
    let track = this.tracks.get(taskId);
    if (track === undefined) {
      track = { entryStates: new Map<string, string>(), snapshotSeen: false };
      this.tracks.set(taskId, track);
    }
    return track;
  }
}
