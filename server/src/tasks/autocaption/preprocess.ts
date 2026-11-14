import Sharp from 'sharp';

import type { CaptionPackDefinition } from './pack';

/** The pack fields preprocessing needs; also the caption worker request's payload. */
export type CaptionPreprocess = Pick<CaptionPackDefinition, 'imageSize' | 'resize' | 'mean' | 'std'>;

/**
 * Prepares an image for a caption pack's encoder, laid out as NCHW
 * ([3, imageSize, imageSize]): the same NCHW normalisation as the shared
 * autotag preprocessImage, `(pixel / 255 - mean[c]) / std[c]` per channel.
 *
 * `square` stretches straight to the encoder input (BLIP's ViTImageProcessor);
 * `shortest-edge-crop` scales the shorter side and centre-crops, which is the
 * CLIP preprocessor the GIT-family packs use. Sharp has no PIL-bicubic, so
 * cubic is the closest available kernel: the #159 export parity was 10/10 on
 * identical pixel buffers, while sharp-vs-PIL preprocessing drifted on 8 of 51
 * BLIP captions.
 */
export async function preprocessCaptionImage(source: string | Buffer, pack: CaptionPreprocess): Promise<Float32Array> {
  const { imageSize, mean, std } = pack;

  // rotate() auto-orients into the display orientation, matching the repo's
  // thumbnails so the caption describes the image the user sees. The Phase 0b
  // parity harness fed unrotated PIL pixels, so an EXIF-rotated input is
  // intentionally allowed to differ from that harness's result.
  const resized = await Sharp(source)
    .rotate()
    .resize(imageSize, imageSize, { kernel: 'cubic', fit: pack.resize === 'shortest-edge-crop' ? 'cover' : 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();

  const pixels = imageSize * imageSize;
  const output = new Float32Array(3 * pixels);
  for (let c = 0; c < 3; c++) {
    for (let index = 0; index < pixels; index++) {
      output[c * pixels + index] = (resized[index * 3 + c] / 255 - mean[c]) / std[c];
    }
  }
  return output;
}
