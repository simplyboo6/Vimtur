import { Database } from '../../types';
import { Transcoder } from '../../cache/transcoder';
import FS from 'fs';
import TensorFlow from './tensorflow';

export const MODEL_WIDTH = 224;
export const MODEL_HEIGHT = 224;
// Media that can be used in the model.
export const SUBSET_CRITERIA = {
  //rating: { min: 1 },
  tags: { exists: true },
  type: { equalsAny: ['still'] },
  thumbnail: true,
};

export async function loadFile(absolutePath: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    FS.readFile(absolutePath, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
}

// Model specific pre-processing from https://github.com/himanshu987/VGG16-with-TensorflowJs/blob/82ec4142d559d551a53aa72ea2c467d249280717/client/predict.js#L1081
// TODO This doesn't seem to work well. Gets poor results while training.
const IMAGE_NET_RGB = TensorFlow.tensor1d([123.68, 116.779, 103.939]);
export async function loadImageFileVgg16(
  absolutePath: string,
): Promise<TensorFlow.Tensor3D | TensorFlow.Tensor4D> {
  const raw = await loadFile(absolutePath);
  const res = TensorFlow.tidy(() => {
    const common = TensorFlow.decodeImage(raw)
      .resizeNearestNeighbor([MODEL_WIDTH, MODEL_HEIGHT])
      .toFloat();
    // expandDims adds the batch size of 1.
    return common
      .sub(IMAGE_NET_RGB)
      .reverse(2)
      .expandDims();
  });
  return res as TensorFlow.Tensor3D | TensorFlow.Tensor4D;
}

const MOBILENET_SCALAR = TensorFlow.scalar(127.5);
export async function loadImageFileMobileNet(
  absolutePath: string,
  // Most are this
  width = MODEL_WIDTH,
  height = MODEL_HEIGHT,
): Promise<TensorFlow.Tensor3D | TensorFlow.Tensor4D> {
  const raw = await loadFile(absolutePath);
  const res = TensorFlow.tidy(() => {
    const common = TensorFlow.decodeImage(raw)
      .resizeNearestNeighbor([width, height])
      .toFloat();
    return common
      .sub(MOBILENET_SCALAR)
      .div(MOBILENET_SCALAR)
      .expandDims();
  });
  return res as TensorFlow.Tensor3D | TensorFlow.Tensor4D;
}

// Loads in the common image format
// https://www.tensorflow.org/hub/common_signatures/images#input
export async function loadImageFileCommon(
  absolutePath: string,
  // Most are this
  width = MODEL_WIDTH,
  height = MODEL_HEIGHT,
): Promise<TensorFlow.Tensor3D | TensorFlow.Tensor4D> {
  const raw = await loadFile(absolutePath);

  const res = TensorFlow.tidy(() => {
    const common = TensorFlow.decodeImage(raw)
      .resizeNearestNeighbor([width, height])
      .toFloat();
    return (
      common
        .sub(MOBILENET_SCALAR)
        .div(255)
        // Adds an extra batch size dim of 1.
        .expandDims()
    );
  });
  return res as TensorFlow.Tensor3D | TensorFlow.Tensor4D;
}

export type DatasetMapperFunction = (hash: string) => Promise<TensorFlow.TensorContainer>;
export function createDatasetMapper(database: Database, tags: string[]): DatasetMapperFunction {
  const transcoder = new Transcoder(database);
  return async (hash: string) => {
    const media = await database.getMedia(hash);
    if (!media) {
      throw new Error(`Couldn't find media to generate preview: ${hash}`);
    }

    // This maps the array of tags being trained on to an array of 0's and 1's where it's 1 if the image
    // has the given tag.
    const labelTensor = TensorFlow.tensor1d(
      tags.map(tag => (media.tags.includes(tag) ? 1 : 0)),
      'int32',
    );
    // 1 here is the batch size.
    const reshapedLabelTensor = labelTensor.reshape([1, tags.length]);
    TensorFlow.dispose(labelTensor);
    return {
      xs: await loadImageFileMobileNet(transcoder.getThumbnailPath(media)),
      ys: reshapedLabelTensor,
    };
  };
}
