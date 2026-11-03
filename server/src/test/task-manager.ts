import 'source-map-support/register';

import type { QueuedTask } from '@vimtur/common';
import { expect } from 'chai';
import { describe, it } from 'mocha';
import { execute } from 'proper-job';

import { TaskManager } from '../task-manager';

// The queue entry's description is the task dropdown's label: a runner's
// updateStatus(current, max, info) replaces it for the duration of a run, and
// TaskManager restores the registered description when the entry completes.
// Without the restore, an entry kept after completion (autoClearCompletedTasks
// off, or a failed run) would show its last phase forever.
describe('TaskManager', () => {
  const REGISTERED_DESCRIPTION = 'Registered description';
  const PHASE_DESCRIPTION = 'Phase one';

  /**
   * Starts the task and collects the descriptions the queue reports while it
   * runs. Resolves with the entry from the 'end' event, so the assertions do
   * not depend on whether autoClearCompletedTasks keeps it in the queue.
   */
  function startAndWait(taskManager: TaskManager, id: string): { ended: Promise<QueuedTask>; snapshots: string[] } {
    const snapshots: string[] = [];
    const ended = new Promise<QueuedTask>((resolve, reject) => {
      const onQueue = (queue: QueuedTask[]): void => {
        for (const entry of queue) {
          if (entry.type === id) {
            snapshots.push(entry.description);
          }
        }
      };
      const onEnd = (entry: QueuedTask): void => {
        taskManager.off('queue', onQueue);
        taskManager.off('end', onEnd);
        resolve(entry);
      };
      taskManager.on('queue', onQueue);
      taskManager.on('end', onEnd);
      try {
        taskManager.start(id);
      } catch (err) {
        taskManager.off('queue', onQueue);
        taskManager.off('end', onEnd);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    return { ended, snapshots };
  }

  it('restores the registered description when a reporting task completes', async () => {
    const taskManager = new TaskManager();
    taskManager.addTask('report-phase', {
      id: 'report-phase',
      description: REGISTERED_DESCRIPTION,
      runner: (updateStatus) =>
        execute(
          () => {
            updateStatus(0, 1, PHASE_DESCRIPTION);
            return Promise.resolve([]);
          },
          () => Promise.resolve(),
        ),
    });

    const { ended, snapshots } = startAndWait(taskManager, 'report-phase');
    const entry = await ended;

    expect(snapshots, 'phase reported while running').to.include(PHASE_DESCRIPTION);
    expect(entry.error, 'error').to.equal(undefined);
    expect(entry.complete).to.equal(true);
    expect(entry.description, 'description once ended').to.equal(REGISTERED_DESCRIPTION);
  });

  it('restores the registered description when a reporting task fails', async () => {
    const taskManager = new TaskManager();
    taskManager.addTask('report-fail', {
      id: 'report-fail',
      description: REGISTERED_DESCRIPTION,
      runner: (updateStatus) =>
        execute(
          () => {
            updateStatus(0, 1, PHASE_DESCRIPTION);
            return Promise.reject(new Error('init failed'));
          },
          () => Promise.resolve(),
        ),
    });

    const { ended, snapshots } = startAndWait(taskManager, 'report-fail');
    const entry = await ended;

    expect(snapshots, 'phase reported while running').to.include(PHASE_DESCRIPTION);
    expect(entry.error, 'error').to.be.a('string');
    expect(entry.complete).to.equal(true);
    expect(entry.description, 'description once ended').to.equal(REGISTERED_DESCRIPTION);
  });
});
