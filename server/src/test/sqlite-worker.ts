import 'source-map-support/register';

import Path from 'path';
import { Worker } from 'worker_threads';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import type { SqliteWorkerRequest, SqliteWorkerResult } from '../database/sqlite/worker';

// Talks to the sqlite worker thread directly to pin down behaviours that live
// at the node:sqlite boundary: batched transactions must roll back atomically,
// run results must be plain numbers, and unbindable values must fail loudly
// (values arrive over the wire as unknown[]).
describe('SQLite worker tests', () => {
  let worker: Worker;

  function send(worker: Worker, request: SqliteWorkerRequest[] | SqliteWorkerRequest): Promise<SqliteWorkerResult[]> {
    return new Promise<SqliteWorkerResult[]>((resolve, reject) => {
      const handler = (results: SqliteWorkerResult[]) => {
        worker.off('message', handler);
        if (results[0]?.type === 'err') {
          reject(new Error(results[0].message));
        } else {
          resolve(results);
        }
      };
      worker.on('message', handler);
      worker.postMessage(request);
    });
  }

  function allData(worker: Worker, query: string): Promise<unknown[]> {
    return send(worker, { type: 'all', query }).then((results) => {
      if (results[0]?.type !== 'all') {
        throw new Error('all did not return all result');
      }
      return results[0].data;
    });
  }

  before(async () => {
    worker = new Worker(Path.resolve(__dirname, '../database/sqlite/worker.js'), {
      workerData: { filename: ':memory:' },
    });
    await new Promise<void>((resolve, reject) => {
      worker.on('online', () => resolve());
      worker.on('error', (err) => reject(err instanceof Error ? err : new Error('Worker failed before online')));
    });
    await send(worker, [
      { type: 'exec', query: 'CREATE TABLE `t` (`id` INTEGER PRIMARY KEY, `v` TEXT NOT NULL)' },
      { type: 'run', query: 'INSERT INTO `t` (`v`) VALUES (?)', values: ['a'] },
    ]);
  });

  after(() => {
    worker.postMessage({ type: 'exit' });
  });

  it('runs batched requests in a transaction', async () => {
    const results = await send(worker, [
      { type: 'run', query: 'INSERT INTO `t` (`v`) VALUES (?)', values: ['batch-1'] },
      { type: 'run', query: 'INSERT INTO `t` (`v`) VALUES (?)', values: ['batch-2'] },
    ]);
    expect(results).to.have.lengthOf(2);
    const data = (await allData(worker, 'SELECT `v` FROM `t` ORDER BY `id`')) as Array<{ v: string }>;
    const values = data.map((row) => row.v);
    expect(values).to.contain('batch-1');
    expect(values).to.contain('batch-2');
  });

  it('rolls back the whole batch when a statement fails', async () => {
    const before = (await allData(worker, 'SELECT `v` FROM `t` ORDER BY `id`')) as Array<{ v: string }>;
    const err = await send(worker, [
      { type: 'run', query: 'INSERT INTO `t` (`v`) VALUES (?)', values: ['rolled-back'] },
      { type: 'run', query: 'INSERT INTO `t` (`does_not_exist`) VALUES (?)', values: ['x'] },
    ]).then(
      () => undefined,
      (e: Error) => e,
    );
    expect(err).to.be.instanceOf(Error);
    const after = (await allData(worker, 'SELECT `v` FROM `t` ORDER BY `id`')) as Array<{ v: string }>;
    expect(after).to.deep.equal(before);
  });

  it('returns run changes as a plain number', async () => {
    // Seed rows and assert against a count computed here so the test does not
    // depend on the rows earlier tests left behind.
    await send(worker, [
      { type: 'run', query: 'INSERT INTO `t` (`v`) VALUES (?)', values: ['changes-1'] },
      { type: 'run', query: 'INSERT INTO `t` (`v`) VALUES (?)', values: ['changes-2'] },
    ]);
    const count = ((await allData(worker, 'SELECT COUNT(*) AS `n` FROM `t`')) as Array<{ n: number }>)[0].n;
    const results = await send(worker, [{ type: 'run', query: 'UPDATE `t` SET `v` = `v`' }]);
    if (results[0]?.type !== 'run') {
      throw new Error('run did not return run result');
    }
    expect(typeof results[0].changes).to.equal('number');
    expect(results[0].changes).to.equal(count);
  });

  it('rejects undefined bind values', async () => {
    const err = await send(worker, {
      type: 'all',
      query: 'SELECT * FROM `t` WHERE `v` = ?',
      values: [undefined],
    }).then(
      () => undefined,
      (e: Error) => e,
    );
    expect(err).to.be.instanceOf(Error);
  });

  it('rejects object bind values', async () => {
    const err = await send(worker, {
      type: 'all',
      query: 'SELECT * FROM `t` WHERE `v` = ?',
      // node:sqlite would bind a bare object as a named-parameter bag
      // (writing NULL) rather than failing; the worker must not allow it.
      values: [{}],
    }).then(
      () => undefined,
      (e: Error) => e,
    );
    expect(err).to.be.instanceOf(Error);
  });

  it('rejects boolean bind values', async () => {
    const err = await send(worker, {
      type: 'all',
      query: 'SELECT * FROM `t` WHERE `v` = ?',
      // better-sqlite3 rejected booleans; the connector maps them to 0/1
      // before binding, and the worker keeps rejecting them.
      values: [true],
    }).then(
      () => undefined,
      (e: Error) => e,
    );
    expect(err).to.be.instanceOf(Error);
  });
});
