import OS from 'os';

import type { TaskArgs } from '@vimtur/common';
import { execute, ScalingConnectionPool } from 'proper-job';

import { Transcoder } from '../../cache/transcoder';
import type { Database, RouterTask, TaskRunnerCallback } from '../../types';

import {
  AUTO_TAG_MODELS,
  DEFAULT_AUTO_TAG_MODEL,
  ensureModelDownloaded,
  loadClasses,
  type ModelDefinition,
} from './models';
import { ClassifierWorkerWrapper } from './workers/classifier-worker-wrapper';

// The task referenced when auto-import triggers classification.
export const DEFAULT_TASK_ID = `AUTO-TAG-${DEFAULT_AUTO_TAG_MODEL().id}`;

// Task argument positions, indexed against TaskArgDefinitions above the runner.
const ARG_MODE = 0;

const MODE_SKIP_EXISTING = 'skip-existing';
const MODE_REPLACE = 'replace';

const parallel = OS.cpus().length;

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
      ],
      runner: (updateStatus: TaskRunnerCallback, args?: TaskArgs) => {
        return execute(
          async () => {
            const mode = args?.[ARG_MODE] ?? MODE_SKIP_EXISTING;
            if (mode !== MODE_SKIP_EXISTING && mode !== MODE_REPLACE) {
              throw new Error(`Unexpected AUTO-TAG mode: ${mode}`);
            }

            const hashes = await database.subset({
              type: { equalsAny: ['still'] },
              autoTags: mode === MODE_SKIP_EXISTING ? { exists: false } : undefined,
              thumbnail: true,
            });
            console.log(`Classifying ${hashes.length} images (${mode})`);
            if (hashes.length === 0) {
              return [];
            }

            updateStatus(0, hashes.length);

            // This pre-downloads the model so that the workers don't each
            // attempt parallel downloads.
            await ensureModelDownloaded(modelDefinition);
            loadClasses();

            // Only begin creating runners when the pool completes.
            const pool = new ScalingConnectionPool(
              () => {
                return new ClassifierWorkerWrapper();
              },
              {
                maxInstances: parallel,
              },
            );

            return {
              iterable: hashes,
              init: {
                current: 0,
                max: hashes.length,
                pool,
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
                instance.classify(modelDefinition, transcoder.getThumbnailPath(media)),
              );
              await database.saveMedia(hash, { autoTags: labels });
            } finally {
              init.current += 1;
              updateStatus(init.current, init.max);
            }
          },
          { parallel, continueOnError: true },
          (init) => init?.pool?.quit(),
        );
      },
    };
  });
}
