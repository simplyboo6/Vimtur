// Taken from https://github.com/danm/image-hash/blob/master/src/block-hash.ts
// Which in turn was taken from https://github.com/commonsmachinery/blockhash-js/blob/master/index.js
// The changes in this file are to add stronger typings.

export type ArrayLikeBuffer = Buffer | Uint8Array | number[];

export interface BlockhashImageData {
  data: ArrayLikeBuffer;
  width: number;
  height: number;
}

function median(data: ArrayLikeBuffer): number {
  const mdarr = data.slice(0).sort((a, b) => a - b);
  if (mdarr.length % 2 === 0) {
    return (mdarr[mdarr.length / 2] + mdarr[mdarr.length / 2 + 1]) / 2.0;
  }
  return mdarr[Math.floor(mdarr.length / 2)];
}

function translateBlocksToBits(blocks: number[], pixelsPerBlock: number): number[] {
  const newblocks: number[] = [];
  const halfBlockValue = (pixelsPerBlock * 256 * 3) / 2;
  const bandsize = blocks.length / 4;

  // Compare medians across four hor  zontal bands
  for (let i = 0; i < 4; i += 1) {
    const m = median(blocks.slice(i * bandsize, (i + 1) * bandsize));
    for (let j = i * bandsize; j < (i + 1) * bandsize; j += 1) {
      const v = blocks[j];
      // Output a 1 if the block is brighter than the median.
      // With images dominated by black or white, the median may
      // end up being 0 or the max value, and thus having a lot
      // of blocks of value equal to the median.  To avoid
      // generating hashes of all zeros or ones, in that case output
      // 0 if the median is in the lower value space, 1 otherwise
      newblocks[j] = Number(v > m || (Math.abs(v - m) < 1 && m > halfBlockValue));
    }
  }

  return newblocks;
}

function bitsToHexhash(bitsArray: number[]): string {
  const hex: string[] = [];
  for (let i = 0; i < bitsArray.length; i += 4) {
    const nibble = bitsArray.slice(i, i + 4);
    hex.push(String(parseInt(nibble.join(''), 2).toString(16)));
  }

  return hex.join('');
}

function bmvbhashEven(data: BlockhashImageData, bits: number): string {
  const blocksizeX = Math.floor(data.width / bits);
  const blocksizeY = Math.floor(data.height / bits);

  const result: number[] = [];

  for (let y = 0; y < bits; y += 1) {
    for (let x = 0; x < bits; x += 1) {
      let total = 0;

      for (let iy = 0; iy < blocksizeY; iy += 1) {
        for (let ix = 0; ix < blocksizeX; ix += 1) {
          const cx = x * blocksizeX + ix;
          const cy = y * blocksizeY + iy;
          const ii = (cy * data.width + cx) * 4;

          const alpha = data.data[ii + 3];
          if (alpha === 0) {
            total += 765;
          } else {
            total += data.data[ii] + data.data[ii + 1] + data.data[ii + 2];
          }
        }
      }

      result.push(total);
    }
  }

  const bitBlocks = translateBlocksToBits(result, blocksizeX * blocksizeY);
  return bitsToHexhash(bitBlocks);
}

function bmvbhash(data: BlockhashImageData, bits: number): string {
  const result: number[] = [];
  let weightTop: number;
  let weightBottom: number;
  let weightLeft: number;
  let weightRight: number;
  let blockTop: number;
  let blockBottom: number;
  let blockLeft: number;
  let blockRight: number;
  let yMod: number;
  let yFrac: number;
  let yInt: number;
  let xMod: number;
  let xFrac: number;
  let xInt: number;
  const blocks: number[][] = [];

  const evenX = data.width % bits === 0;
  const evenY = data.height % bits === 0;

  if (evenX && evenY) {
    return bmvbhashEven(data, bits);
  }

  // initialize blocks array with 0s
  for (let i = 0; i < bits; i += 1) {
    blocks.push([]);
    for (let j = 0; j < bits; j += 1) {
      blocks[i].push(0);
    }
  }

  const blockWidth = data.width / bits;
  const blockHeight = data.height / bits;

  for (let y = 0; y < data.height; y += 1) {
    if (evenY) {
      // don't bother dividing y, if the size evenly divides by bits
      blockBottom = Math.floor(y / blockHeight);
      blockTop = blockBottom;
      weightTop = 1;
      weightBottom = 0;
    } else {
      yMod = (y + 1) % blockHeight;
      yFrac = yMod - Math.floor(yMod);
      yInt = yMod - yFrac;

      weightTop = 1 - yFrac;
      weightBottom = yFrac;

      // y_int will be 0 on bottom/right borders and on block boundaries
      if (yInt > 0 || y + 1 === data.height) {
        blockBottom = Math.floor(y / blockHeight);
        blockTop = blockBottom;
      } else {
        blockTop = Math.floor(y / blockHeight);
        blockBottom = Math.ceil(y / blockHeight);
      }
    }

    for (let x = 0; x < data.width; x += 1) {
      let avgvalue: number;
      const ii = (y * data.width + x) * 4;
      const alpha = data.data[ii + 3];
      if (alpha === 0) {
        avgvalue = 765;
      } else {
        avgvalue = data.data[ii] + data.data[ii + 1] + data.data[ii + 2];
      }

      if (evenX) {
        blockRight = Math.floor(x / blockWidth);
        blockLeft = blockRight;
        weightLeft = 1;
        weightRight = 0;
      } else {
        xMod = (x + 1) % blockWidth;
        xFrac = xMod - Math.floor(xMod);
        xInt = xMod - xFrac;

        weightLeft = 1 - xFrac;
        weightRight = xFrac;

        // x_int will be 0 on bottom/right borders and on block boundaries
        if (xInt > 0 || x + 1 === data.width) {
          blockRight = Math.floor(x / blockWidth);
          blockLeft = blockRight;
        } else {
          blockLeft = Math.floor(x / blockWidth);
          blockRight = Math.ceil(x / blockWidth);
        }
      }

      // add weighted pixel value to relevant blocks
      blocks[blockTop][blockLeft] += avgvalue * weightTop * weightLeft;
      blocks[blockTop][blockRight] += avgvalue * weightTop * weightRight;
      blocks[blockBottom][blockLeft] += avgvalue * weightBottom * weightLeft;
      blocks[blockBottom][blockRight] += avgvalue * weightBottom * weightRight;
    }
  }

  for (let i = 0; i < bits; i += 1) {
    for (let j = 0; j < bits; j += 1) {
      result.push(blocks[i][j]);
    }
  }

  const bitBlocks = translateBlocksToBits(result, blockWidth * blockHeight);
  return bitsToHexhash(bitBlocks);
}

const oneBits = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/* Calculate the hamming distance for two hashes in hex format */
export function hammingDistance(hash1: string, hash2: string): number {
  let d = 0;

  if (hash1.length !== hash2.length) {
    throw new Error("Can't compare hashes with different length");
  }

  for (let i = 0; i < hash1.length; i++) {
    const n1 = parseInt(hash1[i], 16);
    const n2 = parseInt(hash2[i], 16);
    d += oneBits[n1 ^ n2];
  }
  return d;
}

export function blockhash(imgData: BlockhashImageData, bits: number, method: 'quick' | 'precise'): string {
  let hash: string;

  if (method === 'quick') {
    hash = bmvbhashEven(imgData, bits);
  } else if (method === 'precise') {
    hash = bmvbhash(imgData, bits);
  } else {
    throw new Error('Bad hashing method');
  }

  return hash;
}
