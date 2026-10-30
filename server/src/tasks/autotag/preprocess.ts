import Sharp from 'sharp';

import type { Preprocessing } from './models';

/**
 * Prepares an image for a model described by `preprocessing`: resize so the
 * shorter side is `resizeShorterSide` pixels (aspect preserved), centre-crop
 * to the model input square, normalise per channel with
 * `(pixel / 255 - mean[c]) / std[c]`, and lay the batch of one out as NCHW.
 */
export async function preprocessImage(source: string | Buffer, preprocessing: Preprocessing): Promise<Float32Array> {
  const { resizeShorterSide, cropSize, mean, std } = preprocessing;

  // Thumbnails may be missing EXIF orientation; rotate() corrects for it so
  // the crop sees what the model would have been validated against.
  const oriented = Sharp(source).rotate();
  const meta = await oriented.metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Cannot read image dimensions from ${meta.format ?? 'image'} input`);
  }
  const shorter = Math.min(meta.width, meta.height);
  const width = Math.round((meta.width * resizeShorterSide) / shorter);
  const height = Math.round((meta.height * resizeShorterSide) / shorter);

  // Both sides end up at least resizeShorterSide pixels, so this centre crop
  // always has room. Layout below assumes RGB.
  const resized = await oriented
    .resize(width, height, { kernel: 'cubic', fit: 'fill', withoutEnlargement: false })
    .extract({
      left: Math.floor((width - cropSize) / 2),
      top: Math.floor((height - cropSize) / 2),
      width: cropSize,
      height: cropSize,
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  const pixels = cropSize * cropSize;
  const output = new Float32Array(3 * pixels);
  for (let c = 0; c < 3; c++) {
    for (let index = 0; index < pixels; index++) {
      output[c * pixels + index] = (resized[index * 3 + c] / 255 - mean[c]) / std[c];
    }
  }
  return output;
}

/**
 * Picks the `count` highest labels. Models output logits (or softmax
 * probabilities); softmaxing double-softmaxed output is order-preserving, so
 * the ranking is correct either way. Only the label strings are persisted.
 */
export function topLabels(logits: ArrayLike<number>, classes: readonly string[], count: number): string[] {
  if (logits.length !== classes.length) {
    throw new Error(`Model output has ${logits.length} classes, label list has ${classes.length}`);
  }
  const indices = Array.from({ length: classes.length }, (_, i) => i);
  indices.sort((a, b) => logits[b] - logits[a]);
  return indices.slice(0, count).map((index) => classes[index]);
}
