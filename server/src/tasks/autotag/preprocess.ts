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

  // rotate() reorients into the display orientation. metadata() still reports
  // the stored dimensions though, so orientations ≥ 5 (transposing) need their
  // width and height swapped, otherwise the resize distorts before the crop.
  const oriented = Sharp(source).rotate();
  const meta = await oriented.metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`Cannot read image dimensions from ${meta.format ?? 'image'} input`);
  }
  const rawWidth = (meta.orientation ?? 1) >= 5 ? meta.height : meta.width;
  const rawHeight = (meta.orientation ?? 1) >= 5 ? meta.width : meta.height;
  const shorter = Math.min(rawWidth, rawHeight);
  const width = Math.round((rawWidth * resizeShorterSide) / shorter);
  const height = Math.round((rawHeight * resizeShorterSide) / shorter);

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
 * Picks the `count` highest labels. Registry models emit logits (some emit
 * probabilities); because softmax is monotonic, the ranking is the same for
 * either, so no softmax is needed before ranking. Only the label strings are
 * persisted; scores are dropped.
 */
export function topLabels(logits: ArrayLike<number>, classes: readonly string[], count: number): string[] {
  if (logits.length !== classes.length) {
    throw new Error(`Model output has ${logits.length} classes, label list has ${classes.length}`);
  }
  const indices = Array.from({ length: classes.length }, (_, i) => i);
  indices.sort((a, b) => logits[b] - logits[a]);
  return indices.slice(0, count).map((index) => classes[index]);
}
