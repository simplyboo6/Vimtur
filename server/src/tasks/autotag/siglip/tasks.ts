/**
 * Zero-shot Auto-Tagging tasks over the SigLIP-2 embedding pipeline:
 * AUTO-TAG-SIGLIP2-B32 scores stills against the thresholds a calibration run
 * derived, and CALIBRATE-SIGLIP2-B32 derives those thresholds from manually
 * tagged stills. Both encode their prompts through the same helper, so a
 * decision always scores the exact prompt table the calibration used.
 */

import type { Autotag, Configuration, TaskArgs } from '@vimtur/common';
import { execute } from 'proper-job';

import { Transcoder } from '../../../cache/transcoder';
import Config from '../../../config';
import type { Database, RouterTask, TaskRunnerCallback } from '../../../types';

import { computeFingerprint, embeddingsIndex, loadEmbeddingCache, saveEmbeddingCache } from './embed-cache';
import { encoderInstances, ensureEncoderPool } from './encoder';
import type { EncoderPool } from './encoder';
import { auroc, bestF1Threshold } from './metrics';
import { AVES_SIGLIP2_B32 } from './pack';
import type { EmbeddingPackDefinition } from './pack';
import { buildPromptTable } from './prompts';
import type { TagPrompt } from './prompts';
import { makeTagScorer } from './scoring';
import {
  AUTO_TAG_TASK_ID,
  autotagSettings,
  CALIBRATION_TASK_ID,
  configuredTags,
  deriveTagState,
  loadCalibrationRun,
  saveCalibrationRun,
} from './state';

// Task argument positions, indexed against the two-entry args definition of
// the auto-tagging task below.
const ARG_MODE = 0;
const ARG_TAGGED = 1;

const MODE_SKIP_EXISTING = 'skip-existing';
const MODE_REPLACE = 'replace';

const MODE_SKIP_TAGGED = 'skip-tagged';
const MODE_INCLUDE_TAGGED = 'include-tagged';

// Canonical image-encoding slice: a 512-still slice feeds the encoder pool as
// 16 requests of 32 stills, each strided by the worker into 8 IMAGE_BATCHes.
// Fixed slice boundaries keep the internal batch composition a strict function
// of the still order rather than of scheduling: a quantised model derives its
// activation scales per run, so composition changes move scores.
const EMBEDDING_SLICE_SIZE = 512;

// Scoring is synchronous CPU work over every still x prompt, so yield after
// this many prompt scores to keep the event loop responsive on large
// libraries. The yield serves status reads, log flushing and socket drains,
// not cancellation: the runners only observe cancellation from the apply phase.
const SCORE_OPERATIONS_PER_YIELD = 100_000;

/** One still's auto-tag decision, applied by the process phase. */
interface AutoTagWrite {
  hash: string;
  tags: string[];
}

/** Image embeddings joined for the whole cache, addressed by still hash. */
interface EmbeddingSet {
  joined: Float32Array;
  dims: number;
  hashToRow: Map<string, number>;
}

export function getTask(database: Database): RouterTask[] {
  const transcoder = new Transcoder(database);

  return [
    {
      id: AUTO_TAG_TASK_ID,
      description: `Auto-Tag - Score stills against their calibrated tags using zero-shot embeddings (${AVES_SIGLIP2_B32.name})`,
      args: [
        {
          // Omitted or empty arguments default to 'skip-existing', so existing
          // callers only ever tag media that has no auto-generated tags yet.
          type: 'select',
          name: 'Existing tags',
          values: [
            { id: MODE_SKIP_EXISTING, name: 'Skip media that already has auto-generated tags' },
            {
              id: MODE_REPLACE,
              name: 'Replace existing auto-generated tags as media is reclassified',
              confirm:
                'Reclassify media even when it already has auto-generated tags, and overwrite them as each item completes.',
            },
          ],
        },
        {
          // Omitted or empty arguments default to 'skip-tagged': a manual tag is
          // the user's own judgement, so auto-tagging must not add to or
          // overwrite it unless explicitly asked. This is the requested
          // "tags should override auto tags" behaviour, and the existing-args
          // default above is unchanged.
          type: 'select',
          name: 'Tag media with manual tags',
          values: [
            { id: MODE_SKIP_TAGGED, name: 'Skip media the user has manually tagged' },
            {
              id: MODE_INCLUDE_TAGGED,
              name: 'Include manually tagged media',
              confirm:
                'Include media that already carries manual tags. Those manual tags will not be protected: auto-generated tags are written alongside them.',
            },
          ],
        },
      ],
      runner: (updateStatus: TaskRunnerCallback, args?: TaskArgs) => {
        // Embedding and scoring both finish inside this init phase, before the
        // first per-item callback, so a cancellation is only observed once the
        // apply phase begins. Accepted: the same download-and-plan-then-apply
        // shape as the other pipelines.
        return execute(
          async () => {
            const mode = args?.[ARG_MODE] ?? MODE_SKIP_EXISTING;
            if (mode !== MODE_SKIP_EXISTING && mode !== MODE_REPLACE) {
              throw new Error(`Unexpected AUTO-TAG mode: ${mode}`);
            }
            const taggedMode = args?.[ARG_TAGGED] ?? MODE_SKIP_TAGGED;
            if (taggedMode !== MODE_SKIP_TAGGED && taggedMode !== MODE_INCLUDE_TAGGED) {
              throw new Error(`Unexpected AUTO-TAG tagged mode: ${taggedMode}`);
            }

            const settings = autotagSettings();
            const hashes = await database.subset({
              type: { equalsAny: ['still'] },
              autoTags: mode === MODE_SKIP_EXISTING ? { exists: false } : undefined,
              tags: taggedMode === MODE_SKIP_TAGGED ? { exists: false } : undefined,
              thumbnail: true,
            });
            console.log(`Tagging ${hashes.length} stills with zero-shot embeddings (${mode}, ${taggedMode})`);
            if (hashes.length === 0) {
              return [];
            }

            // Only configured DB tags are scored: an entry under
            // autotags.tags is the user's opt-in, and a config entry whose tag
            // the library no longer has is filtered out by the same helper (the
            // next calibration purges it, but until then it must not be
            // scored). The helper also sorts, so prompt-table positions are
            // stable even though sqlite's getTags is unordered.
            const tagList = configuredTags(await database.getTags(), settings);
            const storedRun = await loadCalibrationRun(database);
            // Thresholds computed in another pack's embedding space are
            // meaningless here, so a mismatched run is ignored entirely.
            if (storedRun && storedRun.modelId !== AVES_SIGLIP2_B32.id) {
              console.warn(`Ignoring the calibration run for ${storedRun.modelId}: expected ${AVES_SIGLIP2_B32.id}`);
            }
            const run = storedRun && storedRun.modelId === AVES_SIGLIP2_B32.id ? storedRun : undefined;
            const thresholds = new Map<string, number>();
            for (const tag of tagList) {
              const state = deriveTagState(tag, settings.tags[tag], run, settings.minSupport);
              // Only a real threshold is ever auto-applied: Review (low
              // support) and Not calibrated tags keep their threshold absent.
              if (state.threshold !== undefined) {
                thresholds.set(tag, state.threshold);
              }
            }
            // Fail before any embedding work: with nothing calibrated the
            // default floor (8, applied to no tags) would otherwise mark the
            // whole library processed with empty writes, and the next
            // skip-existing run would skip everything.
            if (thresholds.size === 0) {
              throw new Error(
                'No tags have an applicable threshold; run CALIBRATE-SIGLIP2-B32 (or set manual thresholds in the Auto-Tagging config) first',
              );
            }
            // Only the calibrated tags are scored, so only they need prompt
            // rows: encoding every uncalibrated library tag would waste a
            // prompt pass.
            const scoringTags = tagList.filter((tag) => thresholds.has(tag));

            // Other tasks keep their registered description: the runner's info
            // string REPLACES queuedTask.description mid-run (task-manager.ts),
            // which flips the task dropdown's label to the current phase, so
            // only progress is reported here. The Auto-Tagging page carries its
            // own status lines.
            updateStatus(0, hashes.length);
            // proper-job calls the teardown with `undefined` when this function
            // rejects, so a failure after the pool exists must quit it here.
            const pool = await ensureEncoderPool(AVES_SIGLIP2_B32);
            try {
              const embeddings = await embedStills(database, transcoder, updateStatus, AVES_SIGLIP2_B32, pool, hashes);

              updateStatus(0, hashes.length);
              const { table, textRows } = await encodePromptTable(pool, AVES_SIGLIP2_B32, scoringTags, settings.tags);
              const scoreTag = makeTagScorer(table, textRows);
              // Prompt scores per still, tracked against the yield budget in
              // score-op units rather than stills: tags carry varying prompt
              // counts, so a still count would not bound the work per yield.
              const promptsPerStill = table.reduce((total, entry) => total + entry.prompts.length, 0);

              const writes: AutoTagWrite[] = [];
              let operations = 0;
              for (const [index, hash] of hashes.entries()) {
                const row = embeddings.hashToRow.get(hash);
                if (row === undefined) {
                  throw new Error(`No embedding row for still: ${hash}`);
                }
                const imgRow = embeddings.joined.subarray(row * embeddings.dims, (row + 1) * embeddings.dims);
                const tags: string[] = [];
                for (const tag of scoringTags) {
                  const threshold = thresholds.get(tag);
                  if (threshold !== undefined && scoreTag(imgRow, tag) >= threshold) {
                    tags.push(tag);
                  }
                }
                // A still that matches no calibrated tag is still written with
                // an empty list: that records it as processed, so a later
                // skip-existing run does not score it again, exactly like the
                // classifier.
                writes.push({ hash, tags });

                operations += promptsPerStill;
                if (operations >= SCORE_OPERATIONS_PER_YIELD) {
                  operations = 0;
                  // Scoring above is synchronous: yield so status reads, log
                  // flushing and socket drains are served while a large
                  // library is scored (cancellation waits for the apply phase).
                  await yieldToEventLoop();
                  updateStatus(index + 1, hashes.length);
                }
              }

              // Reset the counter for the apply phase so per-item progress
              // restarts from zero (same pattern as the classifier).
              updateStatus(0, hashes.length);

              return {
                iterable: writes,
                init: { current: 0, max: hashes.length, pool },
              };
            } catch (err) {
              await pool.quit();
              throw err;
            }
          },
          async (write, init) => {
            if (!init) {
              throw new Error('init not defined');
            }
            await database.saveMedia(write.hash, { autoTags: write.tags });
            init.current += 1;
            updateStatus(init.current, init.max);
          },
          // encoderInstances() is the shared concurrency dial: this same
          // number also caps the encoder pool, so per-item DB writes run no
          // wider than the encoder that produced them.
          { parallel: encoderInstances(), continueOnError: true },
          (init) => init?.pool?.quit(),
        );
      },
    },
    {
      id: CALIBRATION_TASK_ID,
      description: `Auto-Tag - Calibrate tag score thresholds from manually tagged examples (${AVES_SIGLIP2_B32.name})`,
      // No args: the page's settings come from the config overlay, and new arg
      // types only support string/select values.
      args: [],
      runner: (updateStatus: TaskRunnerCallback) => {
        return execute(
          async () => {
            // Entries for tags deleted from the library are purged before this
            // run derives or scores anything: the page renders DB tags only, so
            // a stale entry's thresholds/descriptions are invisible to users
            // but would keep influencing auto-tagging. Purging here keeps the
            // config aligned without adding a config-write capability to
            // HTTP-adjacent code paths.
            const dbTagList = await database.getTags();
            const dbTags = new Set(dbTagList);
            // Only entries in the persisted overlay are in the purge's reach:
            // entries merged from config.json/env are left alone, and are
            // reported separately after the write below. The deletion decision
            // and the written snapshot come from one consistent read pair, so a
            // tag created between the two reads can no longer still lose its
            // entry; this closes that window rather than making the
            // read-modify-write linearizable.
            const [latest, latestTags] = await Promise.all([database.getUserConfig(), database.getTags()]);
            const latestDbTags = new Set(latestTags);
            const staleTags = Object.keys(latest.autotags?.tags ?? {})
              .filter((tag) => !latestDbTags.has(tag))
              .sort();
            if (staleTags.length > 0) {
              const storedTags = { ...(latest.autotags?.tags ?? {}) };
              for (const tag of staleTags) {
                delete storedTags[tag];
              }
              // The config API merges a POST body into the stored overlay and
              // then runs it through setUserOverlay + saveUserConfig; a purge
              // has no body and deepmerge cannot delete a key, so the stored
              // overlay is edited directly before that same
              // validate/rename/persist sequence.
              const persisted = Config.setUserOverlay({
                ...latest,
                autotags: { ...latest.autotags, tags: storedTags },
              });
              await database.saveUserConfig(persisted);
              for (const tag of staleTags) {
                console.warn(`Purged config entry for deleted tag '${tag}' (${staleTags.length} purged)`);
              }
            }
            // The two messages differ because only the overlay purge is
            // actionable through the config API: a tag still in the resulting
            // Config state but absent from the library can only live in
            // config.json/env, so the user has to remove it there.
            for (const tag of Object.keys(autotagSettings().tags)) {
              if (!dbTags.has(tag)) {
                console.warn(
                  `Tag '${tag}' remains defined in config.json but no longer exists in the library; remove it from config.json`,
                );
              }
            }
            const settings = autotagSettings();
            // `sample` picks an arbitrary subset per run, which is safe here:
            // every sampled still is scored exactly once within this run, so
            // all of a tag's scores come from the same sample.
            const hashes = await database.subset({
              type: { equalsAny: ['still'] },
              thumbnail: true,
              tags: { exists: true },
              sample: settings.calibrationSampleSize,
            });
            // The sampled list is consumed in DB order for embedding slices and
            // worker batches; batch-neighbour score drift is accepted exactly
            // like cross-run drift. The list is fixed once fetched, so a sort
            // would only change which stills share a batch, never make the run
            // reproducible.
            console.log(`Calibrating from ${hashes.length} tagged stills`);
            // A user-initiated calibration with no tagged stills can never
            // produce a result: a successful no-op writes no run record, so the
            // page shows a spinner and then nothing changes. Fail loudly so the
            // queue row and task notification carry the reason instead.
            if (hashes.length === 0) {
              throw new Error(
                'No tagged stills to calibrate from; tag some media (e.g. in the media viewer) before running calibration',
              );
            }

            updateStatus(0, Math.max(1, hashes.length));
            // proper-job calls the teardown with `undefined` when this function
            // rejects, so a failure after the pool exists must quit it here.
            const pool = await ensureEncoderPool(AVES_SIGLIP2_B32);
            try {
              const embeddings = await embedStills(database, transcoder, updateStatus, AVES_SIGLIP2_B32, pool, hashes);

              // Fetched once per still: the tags drive both the tag list and
              // the positive/negative split below.
              const mediaTags = new Map<string, string[]>();
              for (const hash of hashes) {
                const media = await database.getMedia(hash);
                if (!media) {
                  throw new Error(`Couldn't find media to calibrate hash: ${hash}`);
                }
                mediaTags.set(hash, media.tags);
              }

              // The DB tag list was snapshotted before embedding (which can take
              // minutes); a tag created during the run appears in this run's
              // perTag only at the next calibration (deriveTagState unaffected).
              // Only configured DB tags are calibrated, matching what the apply
              // run can score: scoring is opt-in through autotags.tags, so no
              // union with media tags or config keys is needed (or wanted).
              const tagList = configuredTags(dbTagList, settings);
              const { table, textRows } = await encodePromptTable(pool, AVES_SIGLIP2_B32, tagList, settings.tags);
              const scoreTag = makeTagScorer(table, textRows);

              const perTag: Record<string, Autotag.TagResult> = {};
              for (const [tagIndex, tag] of tagList.entries()) {
                const positives: number[] = [];
                const negatives: number[] = [];
                for (const hash of hashes) {
                  const row = embeddings.hashToRow.get(hash);
                  if (row === undefined) {
                    throw new Error(`No embedding row for still: ${hash}`);
                  }
                  const imgRow = embeddings.joined.subarray(row * embeddings.dims, (row + 1) * embeddings.dims);
                  const score = scoreTag(imgRow, tag);
                  if ((mediaTags.get(hash) ?? []).includes(tag)) {
                    positives.push(score);
                  } else {
                    negatives.push(score);
                  }
                }

                if (positives.length === 0) {
                  perTag[tag] = { threshold: null, support: 0, quality: null, emitted: false };
                } else if (negatives.length === 0) {
                  // Every sampled still carries the tag: there is no ranking
                  // to calibrate against (AUROC needs both classes), so the tag
                  // stays uncalibrated rather than failing the whole run.
                  perTag[tag] = { threshold: null, support: positives.length, quality: null, emitted: false };
                } else {
                  const threshold = bestF1Threshold(positives, negatives);
                  perTag[tag] = {
                    threshold,
                    support: positives.length,
                    // Below the floor the threshold is recorded but inert,
                    // which deriveTagState mirrors when deciding what to
                    // auto-apply; a signal-less null is never emitted.
                    quality: auroc(positives, negatives),
                    emitted: threshold !== null && positives.length >= settings.minSupport,
                  };
                }
                // One tag's pass is synchronous; refresh the status and yield
                // between tags so a large sample cannot starve status reads,
                // log flushing or socket drains for the whole run.
                updateStatus(tagIndex + 1, Math.max(1, tagList.length));
                await yieldToEventLoop();
              }

              const run: Autotag.CalibrationRun = {
                date: Date.now(),
                modelId: AVES_SIGLIP2_B32.id,
                minSupport: settings.minSupport,
                sampleSize: hashes.length,
                perTag,
              };
              await saveCalibrationRun(database, run);
              const emitted = Object.values(perTag).filter((result) => result.emitted).length;
              console.log(
                `Calibration complete: ${tagList.length} tags from ${hashes.length} stills, ${emitted} emitted`,
              );

              return {
                iterable: [],
                init: { current: 1, max: 1, pool },
              };
            } catch (err) {
              await pool.quit();
              throw err;
            }
          },
          () => Promise.resolve(),
          { parallel: encoderInstances(), continueOnError: true },
          (init) => init?.pool?.quit(),
        );
      },
    },
  ];
}

/**
 * Embeds the thumbnails of `hashes`, reusing rows already in the on-disk
 * embedding cache. The cache accumulates across runs and is therefore usually
 * a superset of this run's subset: the returned matrix is the cached rows in
 * stored order followed by the newly encoded ones, so a save can append rather
 * than rewrite existing rows.
 */
async function embedStills(
  database: Database,
  transcoder: Transcoder,
  updateStatus: TaskRunnerCallback,
  pack: EmbeddingPackDefinition,
  pool: EncoderPool,
  hashes: string[],
): Promise<EmbeddingSet> {
  const fingerprint = computeFingerprint(pack, pool.kind);
  // A stale artifact throws here on purpose: reusing old numerics with a new
  // calibration would silently invalidate every threshold. Let the task fail.
  const cached = await loadEmbeddingCache(pack, fingerprint);
  const rowIndex = cached ? embeddingsIndex(cached) : new Map<string, number>();
  const missing = hashes.filter((hash) => !rowIndex.has(hash));
  let done = hashes.length - missing.length;

  const targetList = [...(cached?.hashes ?? []), ...missing];
  const hashToRow = new Map<string, number>();
  for (const [row, hash] of targetList.entries()) {
    hashToRow.set(hash, row);
  }
  // Every requested still is already cached: cached.data is the loaded
  // artifact, and with no misses targetList is exactly cached.hashes, so the
  // hash-to-row map addresses the same rows. Skip the joined copy entirely.
  if (cached && missing.length === 0) {
    return { joined: cached.data, dims: pack.dim, hashToRow };
  }
  const joined = new Float32Array(targetList.length * pack.dim);
  if (cached) {
    joined.set(cached.data, 0);
  }
  const cachedRows = cached?.hashes.length ?? 0;

  for (let offset = 0; offset < missing.length; offset += EMBEDDING_SLICE_SIZE) {
    const slice = missing.slice(offset, offset + EMBEDDING_SLICE_SIZE);
    const paths: string[] = [];
    for (const hash of slice) {
      const media = await database.getMedia(hash);
      if (!media) {
        throw new Error(`Couldn't find media to embed hash: ${hash}`);
      }
      paths.push(transcoder.getThumbnailPath(media));
    }
    const rows = await pool.encodeImages(pack, paths);
    if (rows.length !== slice.length) {
      throw new Error(`Encoder returned ${rows.length} rows for ${slice.length} stills`);
    }
    for (const [index, row] of rows.entries()) {
      joined.set(row, (cachedRows + offset + index) * pack.dim);
    }
    done += slice.length;
    updateStatus(done, hashes.length);
  }

  if (missing.length > 0) {
    // Subarray views alias `joined`, which is fine: the cache writer streams
    // each row out without retaining it, so no second copy is materialised.
    await saveEmbeddingCache(pack, fingerprint, {
      hashes: targetList,
      dims: pack.dim,
      rows: targetList.map((_, row) => joined.subarray(row * pack.dim, (row + 1) * pack.dim)),
    });
  }

  return { joined, dims: pack.dim, hashToRow };
}

/**
 * Builds the tag-grouped prompt table and encodes every prompt in one pass.
 * Both tasks share it so the rows a decision scores against always belong to
 * the exact table whose entries it iterates.
 */
async function encodePromptTable(
  pool: EncoderPool,
  pack: EmbeddingPackDefinition,
  tagList: string[],
  tags: Record<string, Configuration.AutoTagMetadata>,
): Promise<{ table: TagPrompt[]; textRows: Float32Array[] }> {
  const table = buildPromptTable(tagList, (tag) => tags[tag]?.descriptions);
  const prompts = table.flatMap((entry) => entry.prompts);
  const textRows = await pool.encodeTexts(pack, prompts);
  if (textRows.length !== prompts.length) {
    throw new Error(`Encoder returned ${textRows.length} prompt rows, expected ${prompts.length}`);
  }
  return { table, textRows };
}

/** Lets the event loop serve queued work between chunks of synchronous scoring. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
