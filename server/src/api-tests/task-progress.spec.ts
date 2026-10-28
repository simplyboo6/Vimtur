// Tests for task progress reporting semantics.
//
// Tasks report progress as (current, max) pairs streamed to the client. Two
// conventions are under test:
//
// 1. `max` is the size of the work set for this session — items that need no
//    processing must not contribute to it — and `current` climbs to `max` by
//    completion. The fixture states below are staged so the "needs work"
//    subset is a strict subset of the library, which makes whole-library
//    maxima observable: before the fix, the marked assertions fail because
//    `max` counts every (potentially skippable) library item.
// 2. `current` reaches exactly `max` on completion. Before the fix every task
//    passed the OLD value of its counter (`init.current++`) to
//    updateStatus, so the final tick reported `max - 1` and no task's bar
//    could ever reach 100%.
//
// `max` granularity is task-specific: most tasks count items (files), but
// GENERATE-CACHE counts rough per-quality segment estimates (so very long
// videos move the bar instead of freezing per video), and
// VERIFY-VIDEO-CACHE counts per verified quality. video-a is small enough to
// estimate a single unit, but video-b is deliberately 12s so its
// GENERATE-CACHE work item estimates >1 unit and exercises the estimate
// wiring rather than only the whole-file branch.
//
// The server is started with autoClearCompletedTasks disabled so completed
// queue entries (with their final current/max) can be inspected over HTTP.
//
// The library is built up across the tests: video-a is indexed and fully
// processed, then video-b (different size and 12s duration so it hashes
// distinctly and estimates more than one cache unit) is added mid-session.
// All current/max assertions land in the final state where the library is
// half-processed unless noted.

import FS from 'fs';
import Path from 'path';

import type { QueuedTask } from '@vimtur/common';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import { ApiClient, type ApiServer, assertOk, createVideo, detail, queueTask, startServer, subset } from './harness';

const DRAIN_TIMEOUT_MS = 90_000;
const POLL_MS = 250;

describe('Task progress reporting', () => {
  let server: ApiServer;
  let client: ApiClient;
  let videoA: string; // Hash; indexed and fully processed before videoB exists.
  let videoB: string; // Hash; added to the library partway through the fixture.

  // POSTs the task, then polls the queue (auto-cleared tasks are disabled so
  // entries stay behind) until it completes, returning its final state.
  async function runTaskToCompletion(id: string): Promise<QueuedTask> {
    const queuedId = await queueTask(client, id);
    const deadline = Date.now() + DRAIN_TIMEOUT_MS;
    for (;;) {
      const queue = assertOk(await client.get<QueuedTask[]>('/api/tasks/queue'), 'GET /api/tasks/queue');
      const entry = queue.find((task) => task.id === queuedId);
      if (!entry) {
        throw new Error(`Queued task ${queuedId} vanished from the queue`);
      }
      if (entry.error) {
        throw new Error(`${id} failed: ${entry.error}`);
      }
      if (entry.complete) {
        return entry;
      }
      if (Date.now() > deadline) {
        throw new Error(`${id} did not complete within ${DRAIN_TIMEOUT_MS}ms: ${JSON.stringify(entry)}`);
      }
      await new Promise((resolve) => {
        setTimeout(resolve, POLL_MS);
      });
    }
  }

  // Common expectations for a completed task: current must climb to exactly
  // max, and max must equal the size of this run's work set.
  function assertProgress(entry: QueuedTask, expectMax: number): void {
    expect(entry.current, `${entry.id} current`).to.equal(expectMax);
    expect(entry.max, `${entry.id} max`).to.equal(expectMax);
  }

  before(async function (this: Mocha.Context) {
    this.timeout(240_000);
    server = await startServer({ config: { user: { autoClearCompletedTasks: false } } });
    client = new ApiClient(server.baseUrl);
    await createVideo(server.libraryPath, 'video-a.mp4');
  });

  after(async () => {
    await server?.stop();
  });

  it('indexes the first video', async function (this: Mocha.Context) {
    this.timeout(120_000);
    await runTaskToCompletion('SCAN');
    await runTaskToCompletion('INDEX');

    const hashes = await subset(client, { type: { equalsAll: ['video'] } });
    expect(hashes).to.have.lengthOf(1);
    videoA = hashes[0];
  });

  it('counts only work-set items on the first GENERATE-KEYFRAMES run', async function (this: Mocha.Context) {
    this.timeout(120_000);
    // videoA has no segments yet, so it (the whole library at this point) is
    // the work set.
    assertProgress(await runTaskToCompletion('GENERATE-KEYFRAMES'), 1);

    // Task did its job: the work product exists.
    const media = await detail(client, videoA);
    expect(media.metadata?.segments?.standard.length ?? 0).to.be.at.least(1);
  });

  it('reports a zero work set when GENERATE-KEYFRAMES is re-run (previously counted all videos)', async function (this: Mocha.Context) {
    this.timeout(120_000);
    // videoA has segments now; nothing needs processing. Pre-fix this task
    // reported max = all indexed videos (1) regardless.
    assertProgress(await runTaskToCompletion('GENERATE-KEYFRAMES'), 0);
  });

  it('counts only uncached videos for GENERATE-CACHE (previously counted all videos)', async function (this: Mocha.Context) {
    this.timeout(240_000);
    // First run: videoA genuinely needs its quality cache generated. Its max
    // is segment-granular: an estimated 1 segment (2s video) × 1 missing
    // quality.
    const entry = await runTaskToCompletion('GENERATE-CACHE');
    assertProgress(entry, 1);

    // The segment-level info texts must not permanently replace the task's
    // description in the completed queue entry.
    expect(entry.description).to.equal('Generate missing video caches');
    expect((await detail(client, videoA)).metadata?.qualityCache?.length ?? 0).to.equal(1);

    // Second run: everything cached, work set is empty. Pre-fix max was all
    // non-corrupted videos (1) even though nothing gets transcoded.
    assertProgress(await runTaskToCompletion('GENERATE-CACHE'), 0);
    expect((await detail(client, videoA)).metadata?.qualityCache?.length ?? 0).to.equal(1);
  });

  it('verifying a single cached video reports a matching work set (baseline)', async function (this: Mocha.Context) {
    this.timeout(120_000);
    // Only videoA exists at this point, with one quality cache (the max is
    // per verified quality, so 1 unit — the same size as the library here;
    // baseline for later).
    assertProgress(await runTaskToCompletion('VERIFY-VIDEO-CACHE'), 1);
  });

  it('indexes the second video mid-session', async function (this: Mocha.Context) {
    this.timeout(120_000);
    // Larger and longer (12s) so the content hash differs from videoA *and*
    // its cache work estimates more than one segment unit.
    await createVideo(server.libraryPath, 'video-b.mp4', { duration: 12, size: 160 });
    await runTaskToCompletion('SCAN');
    await runTaskToCompletion('INDEX');

    const hashes = await subset(client, { type: { equalsAll: ['video'] } });
    expect(hashes).to.have.lengthOf(2);
    videoB = hashes.find((hash) => hash !== videoA)!;
  });

  it('counts only the newly added video that needs keyframes (previously counted all videos)', async function (this: Mocha.Context) {
    this.timeout(120_000);
    // videoA is fully processed; only videoB lacks segments. Pre-fix the task
    // reported max = all indexed videos (2).
    assertProgress(await runTaskToCompletion('GENERATE-KEYFRAMES'), 1);

    // Work product landed for videoB.
    const media = await detail(client, videoB);
    expect(media.metadata?.segments?.standard.length ?? 0).to.be.at.least(1);
  });

  it('counts only videos with quality caches for VERIFY-VIDEO-CACHE when the library is half-cached', async function (this: Mocha.Context) {
    this.timeout(120_000);
    // videoB has no quality cache yet, so it must not contribute to the max
    // (per-quality units: videoA's single cache = 1). Pre-fix max counted
    // every video (2).
    assertProgress(await runTaskToCompletion('VERIFY-VIDEO-CACHE'), 1);
  });

  it('counts only videos with quality caches for CLEAR-LEGACY-CACHE (previously counted all videos)', async function (this: Mocha.Context) {
    this.timeout(120_000);
    const before = await detail(client, videoA);
    // Only videoA has a quality cache to inspect; videoB must be excluded.
    assertProgress(await runTaskToCompletion('CLEAR-LEGACY-CACHE'), 1);

    // No legacy caches exist so nothing changed.
    const after = await detail(client, videoA);
    expect(after.metadata?.qualityCache).to.deep.equal(before.metadata?.qualityCache);
  });

  it('counts only the uncached video for GENERATE-CACHE mid-session (previously counted all videos)', async function (this: Mocha.Context) {
    this.timeout(240_000);
    // Only videoB lacks a quality cache. Its max is segment-granular: the
    // 12s video estimates floor(12/10) + 3 = 4 segments × 1 missing quality,
    // which exercises the estimate wiring rather than the single-unit
    // whole-file branch videoA hit above.
    assertProgress(await runTaskToCompletion('GENERATE-CACHE'), 4);
    expect((await detail(client, videoB)).metadata?.qualityCache?.length ?? 0).to.equal(1);
  });

  it('reports a zero work set for GENERATE-KEYFRAMES when both videos are processed (previously counted all videos)', async function (this: Mocha.Context) {
    this.timeout(120_000);
    assertProgress(await runTaskToCompletion('GENERATE-KEYFRAMES'), 0);
  });

  it('rescan-video-metadata counts only videos missing artist/album/title (previously counted all videos)', async function (this: Mocha.Context) {
    this.timeout(120_000);
    // Neither video has embedded metadata or a sidecar yet: both need a probe.
    assertProgress(await runTaskToCompletion('RESCAN-VIDEO-METADATA'), 2);

    // Give videoA a sidecar so the next pass can complete its metadata.
    const mediaA = await detail(client, videoA);
    FS.writeFileSync(
      Path.join(server.libraryPath, `${mediaA.path}.json`),
      JSON.stringify({ artist: 'Sidecar Artist', album: 'Sidecar Album', title: 'Sidecar Title' }),
    );
    // Second pass: both videos are missing at least one of the three fields
    // (videoA until the sidecar is applied). Pre-fix max was all videos (2)
    // for the wrong reason; post-fix both genuinely need a probe.
    await runTaskToCompletion('RESCAN-VIDEO-METADATA');

    // The sidecar data must have been applied by that pass.
    const mediaAAfter = await detail(client, videoA);
    expect(mediaAAfter.metadata?.artist).to.equal('Sidecar Artist');
    expect(mediaAAfter.metadata?.album).to.equal('Sidecar Album');
    expect(mediaAAfter.metadata?.title).to.equal('Sidecar Title');

    // Third pass: videoA is complete; only videoB remains in the work set.
    // Pre-fix max stayed 2.
    assertProgress(await runTaskToCompletion('RESCAN-VIDEO-METADATA'), 1);
  });

  it('add-create-times reports a zero work set when indexing already recorded creation times', async function (this: Mocha.Context) {
    this.timeout(120_000);
    // INDEX sets createdAt on every media, so this task has nothing to do.
    // Pre-fix it never called updateStatus for skipped items (and had no
    // init-phase report), so it reported 0/0 while working through the whole
    // library; post-fix the work set is genuinely empty.
    assertProgress(await runTaskToCompletion('ADD-CREATE-TIMES'), 0);
  });

  it('rehash deliberately hashes every file so its work set is the whole library', async function (this: Mocha.Context) {
    this.timeout(240_000);
    // Guard: this task intentionally scans; its max stays the full library
    // size across runs (and hashes stay stable).
    assertProgress(await runTaskToCompletion('REHASH'), 2);
    assertProgress(await runTaskToCompletion('REHASH'), 2);

    const hashes = await subset(client, { type: { equalsAll: ['video'] } });
    expect(hashes.sort()).to.deep.equal([videoA, videoB].sort());
  });
});
