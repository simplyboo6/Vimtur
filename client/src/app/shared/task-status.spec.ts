import { ListedTask, QueuedTask } from '@vimtur/common';
import { describe, expect, it } from 'vitest';

import { TaskStatusTracker } from 'app/shared/task-status';

const TASK_ID = 'AUTO-CAPTION-BLIP-BASE';
const REGISTERED_DESCRIPTION = 'Auto-Caption - Generate searchable captions for stills (BLIP)';

function listedTask(overrides: Partial<ListedTask> = {}): ListedTask {
  return {
    id: TASK_ID,
    description: REGISTERED_DESCRIPTION,
    ...overrides,
  };
}

function queuedTask(overrides: Partial<QueuedTask> = {}): QueuedTask {
  return {
    id: '1',
    type: TASK_ID,
    description: REGISTERED_DESCRIPTION,
    running: false,
    aborted: false,
    current: 0,
    max: 0,
    complete: false,
    ...overrides,
  };
}

describe('TaskStatusTracker', () => {
  it('reads Idle with no queue entry', () => {
    const tracker = new TaskStatusTracker();

    expect(tracker.status(TASK_ID, [], [listedTask()])).toBe('Idle — not currently running.');
  });

  it('reads Queued for an unfinished entry waiting for a worker', () => {
    const tracker = new TaskStatusTracker();

    expect(tracker.status(TASK_ID, [queuedTask()], [listedTask()])).toBe('Queued — waiting for a worker slot.');
  });

  it('reads Running with progress when the description is the registered task description', () => {
    const tracker = new TaskStatusTracker();

    expect(tracker.status(TASK_ID, [queuedTask({ running: true, current: 3, max: 10 })], [listedTask()])).toBe('Running — 3/10 …');
  });

  it('reports a phase label while the description differs from the registered one', () => {
    const tracker = new TaskStatusTracker();
    const entry = queuedTask({ running: true, current: 3, max: 10, description: 'Preparing the model' });

    expect(tracker.status(TASK_ID, [entry], [listedTask()])).toBe('Running — Preparing the model (3/10) …');
  });

  it('raises a failure from a completed errored entry', () => {
    const tracker = new TaskStatusTracker();
    const entry = queuedTask({ complete: true, error: 'model exploded' });
    tracker.sync(TASK_ID, [entry]);

    expect(tracker.failure(TASK_ID)).toBe('model exploded');
    expect(tracker.status(TASK_ID, [entry], [listedTask()])).toBe('Failed — model exploded');
  });

  it('clears a failure when a later run completes without an error', () => {
    const tracker = new TaskStatusTracker();
    tracker.sync(TASK_ID, [queuedTask({ complete: true, error: 'model exploded' })]);
    expect(tracker.failure(TASK_ID)).toBe('model exploded');

    const success = queuedTask({ id: '2', complete: true });
    tracker.sync(TASK_ID, [success]);

    expect(tracker.failure(TASK_ID)).toBeUndefined();
    expect(tracker.status(TASK_ID, [success], [listedTask()])).toBe('Idle — not currently running.');
  });

  it('does not raise a failure for an aborted run', () => {
    const tracker = new TaskStatusTracker();
    tracker.sync(TASK_ID, [queuedTask({ complete: true, aborted: true, error: 'killed' })]);

    expect(tracker.failure(TASK_ID)).toBeUndefined();
  });

  it('does not re-raise an old failure from an unchanged entry after a newer success', () => {
    const tracker = new TaskStatusTracker();
    const failed = queuedTask({ id: '1', complete: true, error: 'model exploded' });
    tracker.sync(TASK_ID, [failed]);
    expect(tracker.failure(TASK_ID)).toBe('model exploded');

    // A newer run clears the failure when it is queued and stays cleared when it
    // completes successfully.
    const success = queuedTask({ id: '2', complete: true });
    tracker.sync(TASK_ID, [failed, queuedTask({ id: '2', running: true, current: 1, max: 5 })]);
    expect(tracker.failure(TASK_ID)).toBeUndefined();
    tracker.sync(TASK_ID, [failed, success]);
    expect(tracker.failure(TASK_ID)).toBeUndefined();

    // The successful entry is spliced out of the queue; only the old failed entry
    // remains and it is unchanged, so it must not re-raise its error.
    tracker.sync(TASK_ID, [failed]);
    expect(tracker.failure(TASK_ID)).toBeUndefined();
  });

  it('seeds a failure from the first snapshot without a prior sync', () => {
    const tracker = new TaskStatusTracker();
    const entry = queuedTask({ complete: true, error: 'failed before the page loaded' });
    tracker.sync(TASK_ID, [entry]);

    // No previous snapshot, so the unchanged-entry skip cannot hide the failure.
    expect(tracker.failure(TASK_ID)).toBe('failed before the page loaded');
  });

  it('forgets a dropped track', () => {
    const tracker = new TaskStatusTracker();
    const failed = queuedTask({ complete: true, error: 'model exploded' });
    tracker.sync(TASK_ID, [failed]);
    expect(tracker.failure(TASK_ID)).toBe('model exploded');

    tracker.forget(TASK_ID);
    expect(tracker.failure(TASK_ID)).toBeUndefined();

    // The next sync seeds the fresh track from scratch, so the same snapshot
    // raises the failure again.
    tracker.sync(TASK_ID, [failed]);
    expect(tracker.failure(TASK_ID)).toBe('model exploded');
  });
});
