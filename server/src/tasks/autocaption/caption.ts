import type { TaskArgs } from '@vimtur/common';
import { execute } from 'proper-job';

import type { Database, RouterTask, TaskRunnerCallback } from '../../types';

import { captionInstances, ensureCaptionerPool } from './captioner';
import { CAPTION_PACKS } from './pack';

// Task argument positions, indexed against the two-entry args definition below
// the runner.
const ARG_MODE = 0;
const ARG_TAGGED = 1;

const MODE_SKIP_EXISTING = 'skip-existing';
const MODE_REPLACE = 'replace';

const MODE_SKIP_TAGGED = 'skip-tagged';
const MODE_INCLUDE_TAGGED = 'include-tagged';

const PHASE_PREPARE_MODEL = 'Preparing the model';
const PHASE_CAPTION = 'Captioning stills';

// One task per registry pack, like the auto-tagging classifiers: the id is
// derived from the pack id so the config's autocaption.model (which
// pickCaptionTask() validates against the same registry) and the roster cannot
// drift apart.
export function getTask(database: Database): RouterTask[] {
  return CAPTION_PACKS.map((pack) => ({
    id: `AUTO-CAPTION-${pack.id}`,
    description: `Auto-Caption - Generate searchable captions for stills (${pack.name})`,
    args: [
      {
        // Omitted or empty arguments default to 'skip-existing', so existing
        // callers only ever caption media that has no generated caption yet.
        type: 'select',
        name: 'Existing captions',
        values: [
          { id: MODE_SKIP_EXISTING, name: 'Skip media that already has a generated caption' },
          {
            id: MODE_REPLACE,
            name: 'Replace existing captions as media is recaptioned',
            confirm:
              'Recaption media even when it already has a generated caption, and overwrite it as each item completes.',
          },
        ],
      },
      {
        // Omitted or empty arguments default to 'skip-tagged': a manual tag is
        // the user's own judgement, so a generated caption must not be added to
        // that media unless explicitly asked. This mirrors the auto-tagging
        // gate and leaves the existing-caption default above unchanged.
        type: 'select',
        name: 'Caption media with manual tags',
        values: [
          { id: MODE_SKIP_TAGGED, name: 'Skip media the user has manually tagged' },
          {
            id: MODE_INCLUDE_TAGGED,
            name: 'Include manually tagged media',
            confirm:
              'Include media that already carries manual tags. A generated caption is written alongside them, and the manual tags are not touched.',
          },
        ],
      },
    ],
    runner: (updateStatus: TaskRunnerCallback, args?: TaskArgs) => {
      return execute(
        async () => {
          const mode = args?.[ARG_MODE] ?? MODE_SKIP_EXISTING;
          if (mode !== MODE_SKIP_EXISTING && mode !== MODE_REPLACE) {
            throw new Error(`Unexpected AUTO-CAPTION mode: ${mode}`);
          }
          const taggedMode = args?.[ARG_TAGGED] ?? MODE_SKIP_TAGGED;
          if (taggedMode !== MODE_SKIP_TAGGED && taggedMode !== MODE_INCLUDE_TAGGED) {
            throw new Error(`Unexpected AUTO-CAPTION tagged mode: ${taggedMode}`);
          }

          // Skipped rows are keyed on autoCaption: { exists: false }: an absent
          // caption is unprocessed while '' is the "processed, nothing
          // generated" marker, so a skip-existing run must leave that marker
          // alone. Manual tags stay protected by default for the same reason
          // auto-tagging does.
          const hashes = await database.subset({
            // Captions are read from the library source, so unlike auto-tagging
            // (which requires thumbnail: true, a state corrupted rows never
            // reach) this filter has to exclude corrupted rows itself: otherwise
            // a still the pipeline already marked corrupted would fail here and
            // turn the whole run into an errored task.
            type: { equalsAny: ['still'] },
            corrupted: false,
            autoCaption: mode === MODE_SKIP_EXISTING ? { exists: false } : undefined,
            tags: taggedMode === MODE_SKIP_TAGGED ? { exists: false } : undefined,
          });
          // No thumbnail filter: captions are generated from the library source
          // (media.absolutePath), not from the cached thumbnail.
          console.log(`Captioning ${hashes.length} images (${mode}, ${taggedMode})`);
          if (hashes.length === 0) {
            return [];
          }

          // Each phase is reported as the queue entry's description so the
          // task dropdown shows what is happening; TaskManager restores the
          // registered description once the entry completes.
          updateStatus(0, hashes.length, PHASE_PREPARE_MODEL);
          // This builds the pool once so the pack download happens here a
          // single time rather than once per worker.
          const pool = await ensureCaptionerPool(pack);
          try {
            // Reset the counter for the captioning phase so per-item progress
            // restarts from zero.
            updateStatus(0, hashes.length, PHASE_CAPTION);

            return {
              iterable: hashes,
              init: {
                current: 0,
                max: hashes.length,
                pool,
              },
            };
          } catch (err) {
            // proper-job calls the teardown with `undefined` when this function
            // rejects, so a failure after the pool exists must quit it here.
            await pool.quit();
            throw err;
          }
        },
        async (hash, init) => {
          if (!init) {
            throw new Error('init not defined');
          }
          const media = await database.getMedia(hash);
          if (!media) {
            throw new Error(`Couldn't find media to caption hash: ${hash}`);
          }

          try {
            // caption is non-null by its type; an empty detokenised string is
            // stored deliberately as the '' processed-with-nothing marker.
            const caption = await init.pool.caption(pack, media.absolutePath);
            await database.saveMedia(hash, { autoCaption: caption });
          } finally {
            init.current += 1;
            updateStatus(init.current, init.max, PHASE_CAPTION);
          }
        },
        { parallel: captionInstances(), continueOnError: true },
        (init) => init?.pool?.quit(),
      );
    },
  }));
}
