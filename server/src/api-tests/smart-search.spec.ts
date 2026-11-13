// Black-box HTTP tests for the zero-shot (SigLIP-2) Auto-Tagging pipeline:
// calibration state, the config overlay the page writes, and the applied-tag
// rules of the AUTO-TAG task. Only the harness, Node builtins and the
// @vimtur/common wire types are used here — never server internals.
//
// Two modes must both pass:
// - default CI: startServer spawns the server with TEST_MODE=1, so the
//   pipeline uses its deterministic fake encoder (no pack, no network);
// - seeded: AUTOTAG_PACK_SEED names a directory containing the real
//   AVES-SIGLIP2-B32 pack files (image.ort, text.ort, tokenizer.json — the
//   POC's copies, byte-identical to the HF release). They are copied into the
//   server's cache before any task runs, and a cached pack always wins over
//   TEST_MODE, so these runs exercise the real encoder.
//
// No mode can reach the network: the harness always sets TEST_MODE on the
// spawned server, and this file's mocha process deliberately does not need it.
// (A skip guard on process.env.TEST_MODE here would be wrong: `yarn test:api`
// starts mocha without TEST_MODE, so it would skip the whole suite in CI even
// though the server child has the fake encoder available.)

import FS from 'node:fs';
import Path from 'node:path';

import type { Autotag, Configuration, Media, QueuedTask } from '@vimtur/common';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
  ApiClient,
  type ApiServer,
  assertOk,
  assertStatus,
  createStill,
  detail,
  queueTask,
  runTaskAndWait,
  startServer,
  subset,
} from './harness';

// Task ids follow the classifier family convention `AUTO-TAG-${model id}`
// (see server/src/tasks/autotag/siglip/tasks.ts); the pack's model id is
// 'AVES-SIGLIP2-B32'. The calibration task id is the one its state record is
// stored under.
const PACK_ID = 'AVES-SIGLIP2-B32';
const AUTO_TAG_TASK_ID = 'AUTO-TAG-AVES-SIGLIP2-B32';
const CALIBRATION_TASK_ID = 'CALIBRATE-SIGLIP2-B32';

// Task argument positions: the queue body is the positional args array, so a
// mode is `['replace']` (or omitted for the default `skip-existing`). The
// second argument controls whether manually tagged media is included; it
// defaults to `skip-tagged`, and these fixtures tag their stills manually, so
// tests that need the old tag-everything behaviour ask for include-tagged.
const MODE_SKIP_EXISTING = 'skip-existing';
const MODE_REPLACE = 'replace';
const MODE_INCLUDE_TAGGED = 'include-tagged';

// The Auto-Tagging page mock's manual, zero-valued threshold tag: zero is a
// real threshold, not an absent value.
const MANUAL_TAG = 'gamma';

const PACK_FILE_NAMES = ['image.ort', 'text.ort', 'tokenizer.json'];
const EMBEDDING_DIMS = 768;

async function getConfig(client: ApiClient): Promise<Configuration.Main> {
  return assertOk(await client.get<Configuration.Main>('/api/config'), 'GET /api/config');
}

async function lastCalibrationRun(client: ApiClient): Promise<Autotag.CalibrationRun> {
  return assertOk(
    await client.get<Autotag.CalibrationRun>(`/api/tasks/state/${CALIBRATION_TASK_ID}/last-run`),
    `GET /api/tasks/state/${CALIBRATION_TASK_ID}/last-run`,
  );
}

async function stillHashes(client: ApiClient): Promise<string[]> {
  return subset(client, { type: { equalsAll: ['still'] } });
}

/**
 * Mirrors the server's precedence rule (the normative implementation is
 * deriveTagState in server/src/tasks/autotag/siglip/state.ts): a manual
 * threshold — including the meaningful zero — is applied as-is; otherwise a
 * calibrated threshold applies only at or above the configured support floor.
 * Review and uncalibrated tags are never applied.
 */
function applicableTags(
  run: Autotag.CalibrationRun,
  tags: Record<string, Configuration.AutoTagMetadata> | undefined,
): Set<string> {
  const allowed = new Set<string>();
  for (const [tag, settings] of Object.entries(tags ?? {})) {
    if (typeof settings?.manualThreshold === 'number') {
      allowed.add(tag);
    }
  }
  for (const [tag, result] of Object.entries(run.perTag)) {
    if (typeof result.threshold === 'number' && result.support >= run.minSupport) {
      allowed.add(tag);
    }
  }
  return allowed;
}

/**
 * Polls the queue until `id` carries an error. Unlike waitForDrainedQueue,
 * which treats any error as a suite failure, this asserts the failure itself.
 */
async function waitForFailedTask(client: ApiClient, id: string, timeoutMs = 90_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const queue = assertOk(await client.get<QueuedTask[]>('/api/tasks/queue'), 'GET /api/tasks/queue');
    const entry = queue.find((task) => task.id === id);
    if (entry?.error !== undefined) {
      return entry.error;
    }
    if (Date.now() > deadline) {
      throw new Error(`Task ${id} did not fail within ${timeoutMs}ms. Remaining: ${JSON.stringify(queue)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function assertAutoTagsWithin(media: Media, allowed: Set<string>, context: string): void {
  for (const tag of media.autoTags ?? []) {
    expect(allowed.has(tag), `${context}: tag '${tag}' was applied but the run could not allow it`).to.equal(true);
  }
}

// Copies the seeded real pack into the server's cache. Hard links avoid
// duplicating ~600MB per run; a cross-device seed falls back to a copy.
function seedPack(cachePath: string, sourceDir: string): void {
  const targetDir = Path.join(cachePath, 'autotag', PACK_ID);
  FS.mkdirSync(targetDir, { recursive: true });
  for (const name of PACK_FILE_NAMES) {
    const source = Path.join(sourceDir, name);
    if (!FS.existsSync(source)) {
      throw new Error(`AUTOTAG_PACK_SEED is set but ${source} is missing; expected the ${PACK_ID} pack files`);
    }
    const target = Path.join(targetDir, name);
    try {
      FS.linkSync(source, target);
    } catch {
      FS.copyFileSync(source, target);
    }
  }
}

describe('Smart-search autotagging', () => {
  const seedDir = process.env['AUTOTAG_PACK_SEED'];
  let server: ApiServer;
  let client: ApiClient;
  let stills: string[];

  before(async function (this: Mocha.Context) {
    // Seeded runs may have to copy the pack (cross-device) before the suite
    // starts; tasks themselves keep the default mocha timeout.
    this.timeout(240_000);
    server = await startServer({});
    client = new ApiClient(server.baseUrl);
    if (seedDir) {
      seedPack(server.cachePath, seedDir);
    }

    const colors = ['red', 'green', 'blue', 'yellow'];
    for (const [index, color] of colors.entries()) {
      await createStill(server.libraryPath, `still-${index + 1}.png`, color);
    }
    await runTaskAndWait(client, 'AUTO-IMPORT');
    stills = await stillHashes(client);
    expect(stills, 'imported stills').to.have.lengthOf(4);
  });

  after(async () => {
    await server?.stop();
  });

  it('serves 404 JSON for the calibration run state before any calibration', async () => {
    // The loud-failure reproducer below also pins this 404 (task-specific
    // behaviour: a failed calibration writes no run record).
    const path = `/api/tasks/state/${CALIBRATION_TASK_ID}/last-run`;
    const data = assertStatus(await client.get<{ message: string }>(path), 404, `GET ${path}`);
    expect(data).to.deep.equal({ message: 'Task state not found' });
  });

  it('fails a calibration over an untagged library instead of recording nothing', async () => {
    // A user-started calibration with no tagged stills can never produce a
    // result: failing loudly surfaces the reason in the queue row and the
    // task notifications, where a successful no-op left the page with no run
    // record to show (and nothing to refresh).
    const id = await queueTask(client, CALIBRATION_TASK_ID);
    const error = await waitForFailedTask(client, id);
    expect(error).to.equal(
      'No tagged stills to calibrate from; tag some media (e.g. in the media viewer) before running calibration',
    );
    const statePath = `/api/tasks/state/${CALIBRATION_TASK_ID}/last-run`;
    const data = assertStatus(await client.get<{ message: string }>(statePath), 404, `GET ${statePath}`);
    expect(data).to.deep.equal({ message: 'Task state not found' });
    // Errored entries persist in the queue (autoClearCompletedTasks only clears
    // successes), so remove it: the drain helper later tests use treats any
    // error entry as a suite failure.
    assertStatus(await client.delete(`/api/tasks/queue/${id}`), 204, `DELETE /api/tasks/queue/${id}`);
  });

  it('fails a user-started zero-shot run fast when nothing is calibrated', async () => {
    // This suite's fresh server has no thresholds; a user-started run must
    // error before embedding anything rather than marking the library
    // processed with empty writes.
    const id = await queueTask(client, AUTO_TAG_TASK_ID);
    const error = await waitForFailedTask(client, id);
    expect(error).to.contain('No tags have an applicable threshold');
    for (const hash of stills) {
      expect((await detail(client, hash)).autoTags, `${hash} autoTags after the failed run`).to.equal(undefined);
    }
    // Errored entries persist in the queue (autoClearCompletedTasks only clears
    // successes), so remove it: the drain helper later tests use treats any
    // error entry as a suite failure.
    assertStatus(await client.delete(`/api/tasks/queue/${id}`), 204, `DELETE /api/tasks/queue/${id}`);
  });

  it('round-trips the autotags section and rejects invalid partial updates', async () => {
    // The overlay-shaped write only carries tags; every other setting must
    // keep its DEFAULTS value.
    const posted = assertOk(
      await client.post<Configuration.Main>('/api/config', {
        autotags: { tags: { sunset: { descriptions: ['a photo of the sun going down'] } } },
      }),
      'POST /api/config autotags.tags.sunset',
    );
    // The model is an AUTO-TAG task id (a plain string, so the schema cannot
    // enumerate the roster); its default is exercised by the routing tests
    // below rather than pinned to a literal here.
    expect(posted.autotags?.model, 'model default').to.be.a('string');
    // The default worker count is derived from the host's RAM at boot, so only
    // the schema's range is pinned here rather than a machine-specific literal.
    expect(posted.autotags?.workers, 'workers default')
      .to.be.a('number')
      .and.to.be.within(1, 8);
    expect(posted.autotags?.minSupport).to.equal(8);
    expect(posted.autotags?.calibrationSampleSize).to.equal(500);
    expect(posted.autotags?.tags?.['sunset']?.descriptions).to.deep.equal(['a photo of the sun going down']);

    const read = await getConfig(client);
    expect(read.autotags?.tags?.['sunset']?.descriptions).to.deep.equal(['a photo of the sun going down']);

    // Null is the documented way to clear a manual override, and must survive
    // the overlay merge without dropping the tag's other fields.
    assertOk(
      await client.post<Configuration.Main>('/api/config', {
        autotags: { tags: { sunset: { manualThreshold: null } } },
      }),
      'POST /api/config autotags.tags.sunset.manualThreshold',
    );
    const cleared = await getConfig(client);
    expect(cleared.autotags?.tags?.['sunset']?.manualThreshold).to.equal(null);
    expect(cleared.autotags?.tags?.['sunset']?.descriptions).to.deep.equal(['a photo of the sun going down']);

    // The autotags schema is strict: bounds, per-tag additional properties and
    // types all surface as the central 400 JSON body.
    const invalidBodies: Array<{ context: string; body: unknown }> = [
      { context: 'workers above the maximum', body: { autotags: { workers: 9 } } },
      { context: 'minSupport below the minimum', body: { autotags: { minSupport: 0 } } },
      {
        context: 'unknown per-tag property',
        body: { autotags: { tags: { sunset: { colour: 'red' } } } },
      },
      { context: 'non-numeric workers', body: { autotags: { workers: 'eight' } } },
    ];
    for (const { context, body } of invalidBodies) {
      const response = await client.post<{ message: string }>('/api/config', body);
      assertStatus(response, 400, `POST /api/config (${context})`);
      expect(response.data, context).to.have.property('message');
    }

    // The model is the AUTO-TAG task id of the selected model rather than a
    // schema enum (the roster is the server's task list), so membership is
    // validated at the use sites, not by the schema: any string round-trips,
    // including one no task serves.
    try {
      for (const model of ['AUTO-TAG-RESNET-50-V2', 'not-a-task']) {
        const selected = assertOk(
          await client.post<Configuration.Main>('/api/config', { autotags: { model } }),
          `POST /api/config autotags.model ${model}`,
        );
        expect(selected.autotags?.model, `posted model ${model}`).to.equal(model);
        expect((await getConfig(client)).autotags?.model, `persisted model ${model}`).to.equal(model);
      }
    } finally {
      // Restore the default task id: the import-routing tests below depend on
      // the selected model starting the zero-shot task.
      assertOk(
        await client.post<Configuration.Main>('/api/config', { autotags: { model: AUTO_TAG_TASK_ID } }),
        'POST /api/config autotags.model restore',
      );
    }

    // A rejected write is never persisted: the rejected workers=9 above left
    // the boot default in place, and that default is RAM-derived, so only its
    // range is pinned.
    const persisted = await getConfig(client);
    expect(persisted.autotags?.workers, 'workers default')
      .to.be.a('number')
      .and.to.be.within(1, 8);
    expect(persisted.autotags?.model).to.equal(AUTO_TAG_TASK_ID);
  });

  it('calibrates per-tag thresholds from manual tags and the merged support floor', async () => {
    // Three alpha examples and one beta example, both below the default
    // minSupport floor of 8. The sample size is 2 against 4 tagged stills, so
    // the run record proves the SQLite engine honours `sample` (default 500
    // would make it unobservable on a library this small).
    assertOk(await client.post<string[]>('/api/tags', { tag: 'alpha' }), 'POST /api/tags alpha');
    assertOk(await client.post<string[]>('/api/tags', { tag: 'beta' }), 'POST /api/tags beta');
    for (const hash of stills.slice(0, 3)) {
      expect((await client.post(`/api/images/${hash}/tags`, { name: 'alpha' })).status).to.equal(204);
    }
    expect((await client.post(`/api/images/${stills[3]}/tags`, { name: 'beta' })).status).to.equal(204);

    // gamma is a manual zero threshold: zero is a real value, so it must apply
    // even though calibration has no gamma examples to learn from. The tag
    // must exist in the library: calibration purges config entries for tags it
    // cannot find in the tag store.
    assertOk(await client.post<string[]>('/api/tags', { tag: MANUAL_TAG }), 'POST /api/tags gamma');
    // Calibration scores only DB tags that also carry a config entry, so alpha
    // and beta need one to reach the run record; their content is irrelevant
    // (an empty entry qualifies, the prompt set is synthesised).
    const configured = assertOk(
      await client.post<Configuration.Main>('/api/config', {
        autotags: {
          workers: 2,
          calibrationSampleSize: 2,
          tags: {
            alpha: {},
            beta: {},
            [MANUAL_TAG]: { manualThreshold: 0 },
          },
        },
      }),
      'POST /api/config autotags.workers + calibrationSampleSize + alpha/beta entries + gamma manualThreshold',
    );
    // An explicit value is honoured when the machine can hold it, so it
    // round-trips exactly (unlike the RAM-derived default).
    expect(configured.autotags?.workers, 'configured workers').to.equal(2);

    await runTaskAndWait(client, CALIBRATION_TASK_ID);
    const run = await lastCalibrationRun(client);

    expect(run.modelId).to.equal(PACK_ID);
    expect(run.minSupport, 'merged minSupport').to.equal(8);
    // The configured sample caps the subset at 2 of the 4 tagged stills.
    expect(run.sampleSize).to.equal(2);
    // The run records the configured size and the eligibility funnel: all 4
    // imported stills are manually tagged and carry a thumbnail.
    expect(run.requestedSampleSize, 'requestedSampleSize').to.equal(2);
    expect(run.taggedMedia, 'taggedMedia').to.equal(4);
    expect(run.taggedStills, 'taggedStills').to.equal(4);
    expect(run.eligibleStills, 'eligibleStills').to.equal(4);
    expect(run.date).to.be.a('number').and.to.be.greaterThan(0);

    const alpha = run.perTag['alpha'];
    expect(alpha, 'perTag.alpha').to.not.equal(undefined);
    // A signal-less calibration (best cut below zero) records null, never a
    // clamped 0: null is never auto-emitted, so a low-quality cut cannot tag
    // the library.
    expect(
      alpha.threshold === null || (typeof alpha.threshold === 'number' && alpha.threshold >= 0),
      'alpha threshold',
    ).to.equal(true);
    // Sampling 2 of 4 stills includes at least one of the three alpha-tagged
    // ones (only stills[3] lacks alpha), but which two are sampled is random.
    expect(alpha.support).to.be.within(1, 2);
    // AUROC is only defined with both classes in the sample; when it is
    // computed it is a fraction.
    expect(
      alpha.quality === null || (typeof alpha.quality === 'number' && alpha.quality >= 0 && alpha.quality <= 1),
      'alpha quality',
    ).to.equal(true);
    expect(alpha.emitted, 'alpha emitted below the floor').to.equal(false);

    const beta = run.perTag['beta'];
    expect(beta, 'perTag.beta').to.not.equal(undefined);
    // beta's only example is stills[3]; the random sample may or may not
    // include it.
    expect(beta.support).to.be.within(0, 1);
    expect(beta.emitted).to.equal(false);

    const manual = run.perTag[MANUAL_TAG];
    expect(manual, `perTag.${MANUAL_TAG}`).to.not.equal(undefined);
    expect(manual.threshold, `${MANUAL_TAG} threshold`).to.equal(null);
    expect(manual.support).to.equal(0);
    expect(manual.emitted).to.equal(false);
  });

  it('auto-tags only the tags the calibration allows', async () => {
    await runTaskAndWait(client, AUTO_TAG_TASK_ID, [MODE_SKIP_EXISTING, MODE_INCLUDE_TAGGED]);

    const run = await lastCalibrationRun(client);
    const config = await getConfig(client);
    const allowed = applicableTags(run, config.autotags?.tags);
    // Only the manual gamma threshold can apply: the sampled alpha (<= 2) and
    // beta (<= 1) support counts are below the floor of 8, so they stay
    // review-inert.
    expect([...allowed].sort()).to.deep.equal([MANUAL_TAG]);

    for (const hash of stills) {
      const media = await detail(client, hash);
      assertAutoTagsWithin(media, allowed, hash);
      expect(media.autoTags ?? [], `${hash} alpha`).to.not.include('alpha');
      expect(media.autoTags ?? [], `${hash} beta`).to.not.include('beta');
    }
  });

  it('CLEAR-TAGGED-AUTOTAGS clears generated tags and a manual override expands the allowed set', async () => {
    await runTaskAndWait(client, 'CLEAR-TAGGED-AUTOTAGS');
    for (const hash of stills) {
      expect((await detail(client, hash)).autoTags, `${hash} autoTags after clear`).to.equal(undefined);
    }

    // alpha is now a manual zero override too, so the allowed set grows to
    // {gamma, alpha}; whether a still actually scores >= 0 for alpha is
    // environment-dependent, so only the subset is asserted.
    assertOk(
      await client.post<Configuration.Main>('/api/config', {
        autotags: { tags: { alpha: { manualThreshold: 0 } } },
      }),
      'POST /api/config alpha manualThreshold',
    );

    await runTaskAndWait(client, AUTO_TAG_TASK_ID, [MODE_SKIP_EXISTING, MODE_INCLUDE_TAGGED]);

    const run = await lastCalibrationRun(client);
    const config = await getConfig(client);
    const allowed = applicableTags(run, config.autotags?.tags);
    expect([...allowed].sort()).to.deep.equal(['alpha', MANUAL_TAG]);

    for (const hash of stills) {
      const media = await detail(client, hash);
      assertAutoTagsWithin(media, allowed, hash);
      expect(media.autoTags ?? [], `${hash} beta`).to.not.include('beta');
    }
  });

  it('auto-tag skip-existing leaves already-processed stills untouched', async () => {
    // Reset the alpha override (gamma stays manual) and clear every still's
    // generated tags so the first run has a full work set.
    assertOk(
      await client.post<Configuration.Main>('/api/config', {
        autotags: { tags: { alpha: { manualThreshold: null } } },
      }),
      'POST /api/config alpha manualThreshold null',
    );
    await runTaskAndWait(client, 'CLEAR-TAGGED-AUTOTAGS');
    for (const hash of stills) {
      expect((await detail(client, hash)).autoTags, `${hash} autoTags after clear`).to.equal(undefined);
    }

    // The first run records every still as processed, even when its generated
    // tag list is empty: skip-existing keys off autoTags, exactly like the
    // classifier.
    await runTaskAndWait(client, AUTO_TAG_TASK_ID, [MODE_SKIP_EXISTING, MODE_INCLUDE_TAGGED]);

    // A manual tag added afterwards must not make skip-existing reconsider the
    // still.
    assertOk(await client.post<string[]>('/api/tags', { tag: MANUAL_TAG }), 'POST /api/tags gamma');
    expect((await client.post(`/api/images/${stills[0]}/tags`, { name: MANUAL_TAG })).status).to.equal(204);

    const before = new Map<string, Media>();
    for (const hash of stills) {
      before.set(hash, await detail(client, hash));
    }

    await runTaskAndWait(client, AUTO_TAG_TASK_ID, [MODE_SKIP_EXISTING, MODE_INCLUDE_TAGGED]);

    for (const hash of stills) {
      expect((await detail(client, hash)).autoTags, `${hash} autoTags after skip-existing rerun`).to.deep.equal(
        before.get(hash)?.autoTags,
      );
    }

    // 'replace' reconsiders every still, but only allowed tags may be written.
    await runTaskAndWait(client, AUTO_TAG_TASK_ID, [MODE_REPLACE, MODE_INCLUDE_TAGGED]);

    const run = await lastCalibrationRun(client);
    const config = await getConfig(client);
    const allowed = applicableTags(run, config.autotags?.tags);
    expect([...allowed].sort()).to.deep.equal([MANUAL_TAG]);

    for (const hash of stills) {
      const media = await detail(client, hash);
      assertAutoTagsWithin(media, allowed, hash);
      expect(media.autoTags ?? [], `${hash} alpha`).to.not.include('alpha');
      expect(media.autoTags ?? [], `${hash} beta`).to.not.include('beta');
    }
  });

  it('default apply skips manually tagged media', async () => {
    // Every still carries a manual tag by now (alpha/beta/gamma). Clearing the
    // auto tags removes the skip-existing exclusion, so the only reason a
    // no-argument run (the AUTO-IMPORT default) can skip them is the
    // skip-tagged default.
    await runTaskAndWait(client, 'CLEAR-TAGGED-AUTOTAGS');
    for (const hash of stills) {
      const media = await detail(client, hash);
      expect(media.autoTags, `${hash} autoTags after clear`).to.equal(undefined);
      expect(media.tags.length, `${hash} manual tags`).to.be.greaterThan(0);
    }

    await runTaskAndWait(client, AUTO_TAG_TASK_ID);

    for (const hash of stills) {
      expect((await detail(client, hash)).autoTags, `${hash} autoTags after the default run`).to.equal(undefined);
    }
  });

  it('include-tagged processes manually tagged media', async () => {
    await runTaskAndWait(client, AUTO_TAG_TASK_ID, [MODE_SKIP_EXISTING, MODE_INCLUDE_TAGGED]);

    const run = await lastCalibrationRun(client);
    const config = await getConfig(client);
    const allowed = applicableTags(run, config.autotags?.tags);
    for (const hash of stills) {
      const media = await detail(client, hash);
      // AUTO-TAG records an autoTags entry (possibly empty) for every still it
      // processes, so undefined proves the run skipped it.
      expect(media.autoTags, `${hash} processed`).to.not.equal(undefined);
      assertAutoTagsWithin(media, allowed, hash);
    }
  });

  it('emits calibrated tags once the support floor is lowered', async () => {
    // Lower the floor to 1, then re-calibrate so the stored run carries it.
    // The 2-still sample always includes at least one alpha example, so alpha
    // meets the floor whenever it has a real threshold; gamma stays a manual
    // override.
    assertOk(
      await client.post<Configuration.Main>('/api/config', {
        autotags: { minSupport: 1 },
      }),
      'POST /api/config minSupport',
    );
    await runTaskAndWait(client, CALIBRATION_TASK_ID);

    const run = await lastCalibrationRun(client);
    const alpha = run.perTag['alpha'];
    expect(alpha.support, 'alpha support').to.be.within(1, 2);
    if (alpha.threshold !== null) {
      expect(alpha.emitted, 'alpha emitted at the lowered floor').to.equal(true);
    } else {
      // A null threshold is recorded and never emitted: either the fake's
      // alpha cut landed in the signal-less range, or the sample happened to
      // contain only alpha-tagged stills (no negatives to rank against). The
      // firing path below is covered whenever a cut does exist.
      expect(alpha.emitted, 'alpha emitted with a null threshold').to.equal(false);
    }

    // 'replace' reconsiders every still, so the now-applicable tag can be
    // written over whatever the earlier runs recorded.
    await runTaskAndWait(client, AUTO_TAG_TASK_ID, [MODE_REPLACE, MODE_INCLUDE_TAGGED]);

    const config = await getConfig(client);
    const allowed = applicableTags(run, config.autotags?.tags);
    // applicableTags already reads the run's own minSupport of 1, so alpha is
    // in the allowed set exactly when it has a real threshold.
    let fired = 0;
    for (const hash of stills) {
      const media = await detail(client, hash);
      assertAutoTagsWithin(media, allowed, hash);
      if ((media.autoTags ?? []).includes('alpha')) {
        fired++;
      }
    }
    if (alpha.threshold !== null) {
      // The F1-optimal cut is at or below the maximum positive score, so at
      // least one of the three positively-tagged stills reaches it.
      expect(fired, 'stills whose autoTags contain alpha').to.be.at.least(1);
    }
  });

  it('purges deleted tags from the config on the next calibration and never emits them', async () => {
    // Once a tag is deleted its config entry is invisible to users (the page
    // renders DB tags only), so calibration must purge it; until then AUTO-TAG
    // must not emit it either.
    assertOk(await client.post<string[]>('/api/tags', { tag: 'epsilon' }), 'POST /api/tags epsilon');
    assertOk(
      await client.post<Configuration.Main>('/api/config', {
        autotags: { tags: { epsilon: { descriptions: ['for deletion smoke'], manualThreshold: 0 } } },
      }),
      'POST /api/config autotags.tags.epsilon',
    );
    // The tags route answers 200 with the remaining tag list.
    assertStatus(await client.delete('/api/tags/epsilon'), 200, 'DELETE /api/tags/epsilon');

    // Score before the calibration below purges the entry. The manual 0 (not
    // 0.5) makes a leak observable: the fake encoder's cosines are roughly
    // symmetric around zero, so an emitted epsilon would fire on about half
    // the stills. The prompt set comes from the tag store, so a deleted tag is
    // never a candidate even while its config entry remains — the dead-tag
    // rule — which makes the assertion below real coverage rather than a
    // threshold the encoder could never reach.
    await runTaskAndWait(client, AUTO_TAG_TASK_ID, [MODE_REPLACE, MODE_INCLUDE_TAGGED]);
    for (const hash of stills) {
      expect((await detail(client, hash)).autoTags ?? [], `${hash} epsilon`).to.not.include('epsilon');
    }

    await runTaskAndWait(client, CALIBRATION_TASK_ID);

    // Only the deleted tag's entry is purged: the entries earlier tests wrote
    // for tags that still exist must survive. (sunset is config-only, never a
    // DB tag, so it is stale by the same rule and is not asserted here.)
    const config = await getConfig(client);
    const tags = config.autotags?.tags ?? {};
    expect(tags, 'config tags after calibration').to.not.have.property('epsilon');
    expect(tags, `config tags after calibration (${MANUAL_TAG})`).to.have.property(MANUAL_TAG);
    expect(tags, 'config tags after calibration (alpha)').to.have.property('alpha');

    const run = await lastCalibrationRun(client);
    expect(run.perTag, 'calibration perTag after deleting epsilon').to.not.have.property('epsilon');

    await runTaskAndWait(client, AUTO_TAG_TASK_ID, [MODE_REPLACE, MODE_INCLUDE_TAGGED]);
    for (const hash of stills) {
      expect((await detail(client, hash)).autoTags ?? [], `${hash} epsilon`).to.not.include('epsilon');
    }
  });

  it('never emits a deleted tag whose config entry still carries a manual threshold', async () => {
    // The no-applicable-thresholds fast path is unreachable at this point in
    // the suite: gamma keeps its manual 0 and alpha/beta may carry thresholds
    // from the purge test's calibration (minSupport 1), so deleting one tag
    // cannot empty the threshold set. Pin the dead-tag rule instead: zeta is
    // deleted while its overlay entry still has a manual 0 and no calibration
    // runs to purge it, so it would fire on about half the stills if the tag
    // store were not the source of the scored tag list.
    assertOk(await client.post<string[]>('/api/tags', { tag: 'zeta' }), 'POST /api/tags zeta');
    assertOk(
      await client.post<Configuration.Main>('/api/config', {
        autotags: { tags: { zeta: { manualThreshold: 0 } } },
      }),
      'POST /api/config autotags.tags.zeta',
    );
    assertStatus(await client.delete('/api/tags/zeta'), 200, 'DELETE /api/tags/zeta');

    // 'replace' re-scores stills that earlier runs already marked processed.
    await runTaskAndWait(client, AUTO_TAG_TASK_ID, [MODE_REPLACE, MODE_INCLUDE_TAGGED]);

    const run = await lastCalibrationRun(client);
    const config = await getConfig(client);
    const allowed = applicableTags(run, config.autotags?.tags);
    // applicableTags mirrors the threshold precedence, not the dead-tag rule,
    // so zeta is still in the set from its manual override; the task must drop
    // it because the tag store no longer has it.
    allowed.delete('zeta');
    for (const hash of stills) {
      const media = await detail(client, hash);
      assertAutoTagsWithin(media, allowed, hash);
      expect(media.autoTags ?? [], `${hash} zeta`).to.not.include('zeta');
    }
  });

  it('routes import-time auto-tagging by the selected model', async () => {
    // Tail placement: the zero-shot run inside AUTO-IMPORT rewrites the
    // stills' autoTags, so no later assertion depends on them. Clearing them
    // first matters: both families' default mode is skip-existing, so with a
    // fully processed library the former classifier-only routing would be a
    // silent no-op and the checks below would prove nothing.
    await runTaskAndWait(client, 'CLEAR-TAGGED-AUTOTAGS');
    for (const hash of stills) {
      expect((await detail(client, hash)).autoTags, `${hash} autoTags after clear`).to.equal(undefined);
    }
    // The apply tasks' other default now skips manually tagged media, and
    // AUTO-IMPORT starts the task with no args, so the fixtures' manual tags
    // must go for the import run to score these stills at all. The calibration
    // run and config thresholds used below do not depend on media tags.
    for (const hash of stills) {
      for (const tag of (await detail(client, hash)).tags) {
        assertStatus(
          await client.delete(`/api/images/${hash}/tags/${tag}`),
          204,
          `DELETE /api/images/${hash}/tags/${tag}`,
        );
      }
    }
    expect(await subset(client, { tags: { exists: true } }), 'manually tagged stills before import').to.deep.equal([]);

    // The selected model is the zero-shot task id and gamma's manual zero is
    // applicable, so AUTO-IMPORT must route to that task. The drain helper
    // fails on any errored queue entry: a classifier route would start
    // AUTO-TAG-MOBILE-NET-V2, whose model pack this harness does not provide,
    // and would also write ImageNet labels outside the applicable set if the
    // download did succeed.
    const enabled = assertOk(
      await client.post<Configuration.Main>('/api/config', {
        enableAutoTags: true,
        autotags: { model: AUTO_TAG_TASK_ID },
      }),
      'POST /api/config enableAutoTags',
    );
    expect(enabled.enableAutoTags).to.equal(true);
    expect(enabled.autotags?.model, 'selected model').to.equal(AUTO_TAG_TASK_ID);

    try {
      await runTaskAndWait(client, 'AUTO-IMPORT');
    } finally {
      // Restore the harness's boot state even if the drain fails.
      assertOk(
        await client.post<Configuration.Main>('/api/config', { enableAutoTags: false }),
        'POST /api/config enableAutoTags false',
      );
    }

    // AUTO-TAG writes an autoTags entry (possibly an empty list) for every
    // still it processes, so an undefined entry proves the run never happened.
    // Without this the allowed-set check below would also pass when the gate
    // skipped auto-tagging entirely.
    for (const hash of stills) {
      expect((await detail(client, hash)).autoTags, `${hash} processed by AUTO-IMPORT`).to.not.equal(undefined);
    }

    // Which tags the run emits is pinned by the tests above; here only the
    // routing is observable, as the applied tags must stay within the set the
    // zero-shot task could have scored (the classifier would write ImageNet
    // labels).
    const run = await lastCalibrationRun(client);
    const config = await getConfig(client);
    const allowed = applicableTags(run, config.autotags?.tags);
    for (const hash of stills) {
      assertAutoTagsWithin(await detail(client, hash), allowed, hash);
    }
  });

  // Seeded-only: pins the on-disk embedding cache the real pack must leave
  // behind (768-d rows, a fingerprint over the pack, a row count matching the
  // metadata). Deeper real-model smoke comparisons stay manual
  // (AVES_SMOKE-style) and are deliberately NOT CI-gated.
  if (seedDir) {
    it('leaves a coherent embedding cache for the seeded pack', () => {
      const packDir = Path.join(server.cachePath, 'autotag', PACK_ID);
      const binPath = Path.join(packDir, 'embeddings.bin');
      const metaPath = Path.join(packDir, 'embeddings.json');
      expect(FS.existsSync(binPath), binPath).to.equal(true);
      expect(FS.existsSync(metaPath), metaPath).to.equal(true);

      const meta = JSON.parse(FS.readFileSync(metaPath, 'utf8')) as {
        hashes: string[];
        dims: number;
        fingerprint: string;
        rows?: number[];
      };
      expect(meta.dims).to.equal(EMBEDDING_DIMS);
      // 64 hex characters: a sha256 over the pack definition, batching and
      // runtime. Recomputing it would import server internals, so the
      // black-box contract pinned here is that it is present, well-formed and
      // matches the metadata's own row count.
      expect(meta.fingerprint).to.match(/^[0-9a-f]{64}$/);
      expect(meta.hashes).to.have.members(stills);
      // The bin is append-only between saves, so a delete can legally leave an
      // unreachable tail; every listed row must still be addressable within it.
      const rows = meta.rows ?? meta.hashes.map((_, index) => index);
      const lastRow = Math.max(-1, ...rows);
      expect(FS.statSync(binPath).size, binPath).to.be.at.least((lastRow + 1) * meta.dims * 4);
      expect(FS.statSync(binPath).size).to.be.greaterThan(0);
    });
  }

  it('drops a deleted still from the embedding index and keeps the survivors loadable', async () => {
    // Black-box wiring for the delete path: the apply tasks above populated
    // the cache, so DELETE must prune this hash from embeddings.json while
    // the survivors stay addressable. The next apply run then loads the
    // pruned index without a save (every survivor is still cached).
    const packDir = Path.join(server.cachePath, 'autotag', PACK_ID);
    const metaPath = Path.join(packDir, 'embeddings.json');
    const before = JSON.parse(FS.readFileSync(metaPath, 'utf8')) as { hashes: string[] };
    const deleted = stills[0];
    expect(before.hashes, 'cache seeded by the apply runs').to.include(deleted);

    assertStatus(await client.delete(`/api/images/${deleted}`), 204, `DELETE /api/images/${deleted}`);

    const after = JSON.parse(FS.readFileSync(metaPath, 'utf8')) as { hashes: string[] };
    expect(after.hashes, 'deleted hash pruned').to.not.include(deleted);
    expect(after.hashes, 'survivors still indexed').to.have.members(stills.slice(1));

    // Re-running the apply task loads the pruned artifact; a misaddressed
    // row or a cache load failure would fail the drain.
    await runTaskAndWait(client, AUTO_TAG_TASK_ID, [MODE_REPLACE, MODE_INCLUDE_TAGGED]);
  });
});

// A dedicated server: the suite above has tags and manual thresholds by this
// point, so the skip path needs a fresh, uncalibrated install. The gate only
// counts stored tags and reads task state (no encoder, no pack download), and
// the zero-shot task fail-fasts before it would load one, so this describe
// stays offline whichever way the gate behaves.
describe('AUTO-IMPORT with an uncalibrated zero-shot pipeline', () => {
  let server: ApiServer;
  let client: ApiClient;

  before(async function (this: Mocha.Context) {
    this.timeout(120_000);
    server = await startServer({ config: { enableAutoTags: true, autotags: { model: AUTO_TAG_TASK_ID } } });
    client = new ApiClient(server.baseUrl);
    await createStill(server.libraryPath, 'uncalibrated.png', 'white');
  });

  after(async () => {
    await server?.stop();
  });

  it('skips the zero-shot task instead of failing the import', async function (this: Mocha.Context) {
    this.timeout(120_000);
    // The zero-shot task is selected, no tag carries a threshold and nothing
    // is calibrated. A gate that started AUTO-TAG-AVES-SIGLIP2-B32 anyway would
    // fail-fast with "No tags have an applicable threshold" and the drain would
    // throw on the errored queue entry, so draining clean is the first half of
    // the discriminator.
    await runTaskAndWait(client, 'AUTO-IMPORT');

    // Second half: the still was imported but never scored. AUTO-TAG records
    // an autoTags entry (possibly an empty list) for every still it processes,
    // so undefined here proves the task never ran.
    const stills = await stillHashes(client);
    expect(stills, 'imported stills').to.have.lengthOf(1);
    expect((await detail(client, stills[0])).autoTags, 'autoTags after the skipped run').to.equal(undefined);
  });
});
