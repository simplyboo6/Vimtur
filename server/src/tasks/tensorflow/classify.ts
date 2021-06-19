import OS from 'os';

import { ScalingConnectionPool, execute } from 'proper-job';

import { Transcoder } from '../../cache/transcoder';
import type { Database, RouterTask, TaskRunnerCallback } from '../../types';

import { ClassifierWorkerWrapper } from './workers/classifier-worker-wrapper';
import { IMAGENET_MODELS, loadClasses, loadModel } from './imagenet';
import TensorFlow from './tensorflow';

// Two if native because it doesn't quite achieve 100% multi-core use,
// likely due to not feeding it data enough.
// One per core if JS only since it's single threaded.
const parallel = TensorFlow.isNative() ? 2 : OS.cpus().length;

export function getTask(database: Database): RouterTask[] {
  const transcoder = new Transcoder(database);

  return IMAGENET_MODELS.map((modelDefinition) => {
    return {
      id: `TENSORFLOW-CLASSIFY-${modelDefinition.id}`,
      description: `Auto-Tag - Classify images using TensorFlow (${modelDefinition.name})`,
      runner: (updateStatus: TaskRunnerCallback) => {
        return execute(
          async () => {
            const hashes = await database.subset({
              type: { equalsAny: ['still'] },
              autoTags: { exists: false },
              thumbnail: true,
            });
            console.log(`Classifying ${hashes.length} images`);
            if (hashes.length === 0) {
              return [];
            }

            updateStatus(0, hashes.length);

            // This pre-downloads the classes and model so that the runners
            // don't each attempt parallel downloads.
            await loadClasses();
            await loadModel(modelDefinition);

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
              throw new Error(`Couldn't find media to generate preview: ${hash}`);
            }

            try {
              const results = await init.pool.run((instance) =>
                instance.classify({
                  definition: modelDefinition,
                  absolutePath: transcoder.getThumbnailPath(media),
                }),
              );
              await database.saveMedia(hash, { autoTags: results.probabilities });
            } finally {
              updateStatus(init.current++, init.max);
            }
          },
          { parallel, continueOnError: true },
          (init) => init?.pool?.quit(),
        );
      },
    };
  });
}
