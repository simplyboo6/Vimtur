import FS from 'fs';

import { PNG } from 'pngjs';
import TFJS from '@tensorflow/tfjs';

function isAvxSupported(): boolean {
  try {
    const cpuInfo = FS.readFileSync('/proc/cpuinfo').toString();
    const rawKeyValues = cpuInfo.split('\n').map((line) => line.split(':'));
    const trimmedKeyValues = rawKeyValues.map((arr) => arr.map((el) => el.trim()));
    const rawFlags = trimmedKeyValues.find(([key]) => key === 'flags');
    if (!rawFlags) {
      console.warn('Unable to find flags in CPU info.');
      return false;
    }
    const flags = rawFlags[1]?.split(' ').map((el) => el.trim());
    if (!flags) {
      console.warn('Unable to extract flags value from key in CPU info.');
      return false;
    }

    if (!flags.includes('avx')) {
      console.warn('CPU does not support avx instructions.');
      return false;
    }

    return true;
  } catch (err) {
    console.warn('Unable to load CPU info.', err.message);
    return false;
  }
}

declare module '@tensorflow/tfjs' {
  export function decodeImage(buffer: Buffer): TFJS.Tensor3D;
  export function isNative(): boolean;
}

export default TFJS;

if (isAvxSupported()) {
  console.log('AVX supported. Using native TensorFlow.');
  // eslint-disable-next-line
  const tfjs = require('@tensorflow/tfjs-node');

  // eslint-disable-next-line no-inner-declarations
  function decodeImage(buffer: Buffer): TFJS.Tensor3D {
    return tfjs.node.decodeImage(buffer, 3) as TFJS.Tensor3D;
  }

  module.exports = {
    ...tfjs,
    decodeImage,
    isNative: () => true,
  };
} else {
  console.warn(
    'Warning: AVX unsupported. Using JS only TensorFlow. Ignore the message claiming you can speed it up, this will be slow.',
  );
  // eslint-disable-next-line
  const tfjs = require('@tensorflow/tfjs');

  // Input buffer must be a png. This is about 10x slower than
  // TensorFlow.node.decodeImage.
  // eslint-disable-next-line no-inner-declarations
  function decodeImage(buffer: Buffer): TFJS.Tensor3D {
    const decoded = PNG.sync.read(buffer);
    const rgbaPixels = decoded.data;
    const rgbPixels = new Int32Array(decoded.width * decoded.height * 3);
    for (let i = 0; i < decoded.width * decoded.height; i++) {
      for (let channel = 0; channel < 3; channel++) {
        rgbPixels[i * 3 + channel] = rgbaPixels[i * 4 + channel];
      }
    }
    return tfjs.tensor3d(rgbPixels, [decoded.height, decoded.width, 3], 'int32');
  }
  module.exports = {
    ...tfjs,
    decodeImage,
    isNative: () => false,
  };
}
