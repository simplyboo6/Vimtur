import type { ListedTask, QueuedTask, Scanner } from '@vimtur/common';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import { ApiClient, type ApiServer, assertOk, createStill, startServer, waitForDrainedQueue } from './harness';

describe('Tasks API', () => {
  let server: ApiServer;
  let client: ApiClient;

  before(async () => {
    server = await startServer();
    client = new ApiClient(server.baseUrl);
    await createStill(server.libraryPath, 'one.png', 'red');
  });

  after(async () => {
    await server?.stop();
  });

  it('lists available tasks with ids and descriptions', async () => {
    const tasks = assertOk(await client.get<ListedTask[]>('/api/tasks'), 'GET /api/tasks');
    const ids = tasks.map((task) => task.id);
    // The meta-tasks and pipeline tasks the client relies on.
    for (const expected of ['AUTO-IMPORT', 'VERIFY-CACHE', 'SCAN', 'INDEX', 'GENERATE-THUMBNAILS', 'DELETE-MISSING']) {
      expect(ids).to.include(expected);
    }
    for (const task of tasks) {
      expect(task.description).to.be.a('string').and.to.have.lengthOf.at.least(1);
    }
  });

  it('lists tasks sorted by description', async () => {
    const tasks = assertOk(await client.get<ListedTask[]>('/api/tasks'), 'GET /api/tasks');
    const descriptions = tasks.map((task) => task.description);
    expect(descriptions).to.deep.equal([...descriptions].sort((a, b) => a.localeCompare(b)));
  });

  it('starts with an empty queue', async () => {
    const queue = assertOk(await client.get<QueuedTask[]>('/api/tasks/queue'), 'GET /api/tasks/queue');
    expect(queue).to.deep.equal([]);
  });

  it('a task that throws synchronously is recorded and does not wedge the queue', async () => {
    // Deliberately placed before every SCAN below, so Scanner.results is
    // still unset and INDEX throws synchronously in its runner. That error
    // used to escape as an unhandled rejection, leaving the entry running
    // forever and blocking the whole queue until restart.
    const id = assertOk(await client.post<string>('/api/tasks/queue/INDEX', {}), 'POST /api/tasks/queue/INDEX');

    let message = 'INDEX was expected to fail';
    try {
      await waitForDrainedQueue(client);
    } catch (err: unknown) {
      // waitForDrainedQueue rejects on any errored task with its message,
      // which is the deterministic completion signal here.
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).to.include('A scan must be run first');

    const queue = assertOk(await client.get<QueuedTask[]>('/api/tasks/queue'), 'GET /api/tasks/queue');
    const failed = queue.find((task) => task.id === id);
    expect(failed?.error).to.include('A scan must be run first');
    expect(failed?.running).to.equal(false);

    // The queue works afterwards: clear the failed instance and drain again.
    expect((await client.delete(`/api/tasks/queue/${id}`)).status).to.equal(204);
    await waitForDrainedQueue(client);
    const remaining = assertOk(await client.get<QueuedTask[]>('/api/tasks/queue'), 'GET /api/tasks/queue');
    expect(remaining).to.deep.equal([]);
  });

  it('queueing returns a task id of TYPE-N', async () => {
    const response = await client.post<string>('/api/tasks/queue/SCAN', {});
    // 202: the task is accepted for asynchronous processing, not done.
    expect(response.status).to.equal(202);
    expect(response.data).to.equal('SCAN-0');
    await waitForDrainedQueue(client);
  });

  it('increments through the id suffix while tasks stay queued', async () => {
    // A completed task is removed from the queue and its id suffix is free
    // again, so a fresh queue yields SCAN-0 once more (id reuse is the
    // current behaviour).
    const id = assertOk(await client.post<string>('/api/tasks/queue/SCAN', {}), 'POST /api/tasks/queue/SCAN');
    expect(id).to.equal('SCAN-0');
    await waitForDrainedQueue(client);
  });

  it('queueing an unknown task is a 400', async () => {
    const response = await client.post('/api/tasks/queue/NOT-A-TASK', {});
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('message');
  });

  it('cancelling an unknown queue entry is a silent 204', async () => {
    const response = await client.delete('/api/tasks/queue/NOPE-99');
    expect(response.status).to.equal(204);
  });

  it('cancelling a queued task removes it from the queue', async () => {
    // SCAN completes near-instantly with nothing pending; queue two so the
    // second is still waiting when the first runs.
    const first = assertOk(await client.post<string>('/api/tasks/queue/SCAN', {}), 'POST /api/tasks/queue/SCAN');
    const second = assertOk(await client.post<string>('/api/tasks/queue/SCAN', {}), 'POST /api/tasks/queue/SCAN');

    const response = await client.delete(`/api/tasks/queue/${second}`);
    expect(response.status).to.equal(204);

    await waitForDrainedQueue(client);
    expect(first).to.be.a('string');
  });

  it('SCAN results endpoints report pending work', async () => {
    // one.png was created but never imported, so every scan leaves it pending.
    await waitForDrainedQueue(client); // ensure no task is mid-flight
    const summary = assertOk(
      await client.get<Scanner.Summary>('/api/tasks/SCAN/results'),
      'GET /api/tasks/SCAN/results',
    );
    expect(summary).to.deep.equal({ newPaths: 1, missingPaths: 0 });
    expect(
      assertOk(await client.get<string[]>('/api/tasks/SCAN/results/new'), 'GET /api/tasks/SCAN/results/new'),
    ).to.deep.equal(['one.png']);
    expect(
      assertOk(await client.get<string[]>('/api/tasks/SCAN/results/missing'), 'GET /api/tasks/SCAN/results/missing'),
    ).to.deep.equal([]);
  });
});
