import type { TaskArgs } from '@vimtur/common';
import { execute, ScalingConnectionPool } from 'proper-job';

import { Transcoder } from '../../../cache/transcoder';
import type { Database, RouterTask, TaskRunnerCallback } from '../../../types';

import { AUTO_TAG_MODELS, ensureModelDownloaded, loadClasses, MAX_INSTANCES, type ModelDefinition } from './models';
import { ClassifierWorkerWrapper } from './workers/classifier-worker-wrapper';

// Task argument positions, indexed against the two-entry args definition
// declared per task role below the runner.
const ARG_MODE = 0;
const ARG_TAGGED = 1;

const MODE_SKIP_EXISTING = 'skip-existing';
const MODE_REPLACE = 'replace';

const MODE_SKIP_TAGGED = 'skip-tagged';
const MODE_INCLUDE_TAGGED = 'include-tagged';

// One task is registered per available model.
export function getTask(database: Database): RouterTask[] {
  const transcoder = new Transcoder(database);

  return AUTO_TAG_MODELS.map((modelDefinition: ModelDefinition) => {
    return {
      id: `AUTO-TAG-${modelDefinition.id}`,
      description: `Auto-Tag - Classify images using image classification (${modelDefinition.name})`,
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

            const hashes = await database.subset({
              type: { equalsAny: ['still'] },
              autoTags: mode === MODE_SKIP_EXISTING ? { exists: false } : undefined,
              tags: taggedMode === MODE_SKIP_TAGGED ? { exists: false } : undefined,
              thumbnail: true,
            });
            console.log(`Classifying ${hashes.length} images (${mode}, ${taggedMode})`);
            if (hashes.length === 0) {
              return [];
            }

            // Only progress is reported, never the info/description string: the
            // runner's third argument REPLACES queuedTask.description mid-run
            // (task-manager.ts), which flips the task dropdown's label to the
            // current phase instead of keeping the registered description.
            updateStatus(0, hashes.length);
            // This pre-downloads the model once so the workers don't each
            // attempt parallel downloads, and so the runner can hand the
            // verified path to the workers. loadClasses() is a fail-fast of
            // the bundled label asset before any worker spins up.
            const modelFile = await ensureModelDownloaded(modelDefinition);
            loadClasses();

            // Reset the counter for the classification phase so per-item
            // progress restarts from zero.
            updateStatus(0, hashes.length);

            // Only begin creating runners when the pool completes.
            const pool = new ScalingConnectionPool(
              () => {
                return new ClassifierWorkerWrapper();
              },
              {
                maxInstances: MAX_INSTANCES,
              },
            );

            return {
              iterable: hashes,
              init: {
                current: 0,
                max: hashes.length,
                pool,
                modelFile,
              },
            };
          },
          async (hash, init) => {
            if (!init) {
              throw new Error('init not defined');
            }
            const media = await database.getMedia(hash);
            if (!media) {
              throw new Error(`Couldn't find media to classify hash: ${hash}`);
            }

            try {
              const labels = await init.pool.run((instance) =>
                instance.classify({
                  definition: modelDefinition,
                  modelPath: init.modelFile,
                  absolutePath: transcoder.getThumbnailPath(media),
                }),
              );
              await database.saveMedia(hash, { autoTags: labels });
            } finally {
              init.current += 1;
              updateStatus(init.current, init.max);
            }
          },
          { parallel: MAX_INSTANCES, continueOnError: true },
          (init) => init?.pool?.quit(),
        );
      },
    };
  });
}
