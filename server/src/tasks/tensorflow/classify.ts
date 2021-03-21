import { Database, RouterTask, TaskRunnerCallback } from '../../types';
import { IMAGENET_MODELS, loadClasses, loadModel } from './imagenet';
import { Transcoder } from '../../cache/transcoder';
import { execute } from 'proper-job';
import { loadImageFileCommon } from './common';
import TensorFlow from './tensorflow';

export function getTask(database: Database): RouterTask[] {
  const transcoder = new Transcoder(database);

  return IMAGENET_MODELS.map(modelDefinition => {
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

            const model = await loadModel(modelDefinition);

            updateStatus(0, hashes.length);
            return {
              iterable: hashes,
              init: {
                model,
                classes: await loadClasses(),
                current: 0,
                max: hashes.length,
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

            const tensor = await loadImageFileCommon(
              transcoder.getThumbnailPath(media),
              modelDefinition.width,
              modelDefinition.height,
            );
            try {
              const classified = init.model.predict(tensor) as TensorFlow.Tensor<TensorFlow.Rank>;
              try {
                const classificationNestedArray = (await classified.array()) as number[][];
                const classificationArray = classificationNestedArray[0];

                const probabilities = classificationArray
                  .map((probability, index) => {
                    return {
                      probability,
                      label: init.classes[index],
                    };
                  })
                  .sort((a, b) => b.probability - a.probability);
                const topFive = probabilities.slice(0, 5);
                await database.saveMedia(hash, { autoTags: topFive.map(output => output.label) });
              } finally {
                classified.dispose();
              }
            } finally {
              tensor.dispose();
              updateStatus(init.current++, init.max);
            }
          },
        );
      },
    };
  });
}
