import Crypto from 'node:crypto';
import FS from 'node:fs';
import Path from 'node:path';

import { IMAGE_BATCH, packDir, TEXT_BATCH } from './pack';
import type { EmbeddingPackDefinition } from './pack';

/**
 * Physical-integrity guard for the embedding artifact `embeddings.bin`:
 * anything that changes what the rows mean (pack files, preprocessing,
 * canonical batch sizes, ONNX runtime build, encoder implementation) must
 * invalidate the cache outright, never silently reuse it — a stale cache would
 * marry old numerics with a new calibration. A fingerprint mismatch makes the
 * load throw and explain how to clear it.
 *
 * SMALL_IMAGE_CHUNK and EMBEDDING_SLICE_SIZE are deliberately excluded: they
 * change request grouping without changing batch internals. That safety
 * degenerates the moment either is not a multiple of IMAGE_BATCH, so keep
 * them multiples.
 *
 * The artifact grows monotonically: rows of media that has since been deleted
 * stay behind until the fingerprint bumps or the cache is deleted manually.
 * Measured size: one 768-wide Float32 row is ~3 KB per still, and the json
 * metadata adds ~67 B per hash. There is no pruning limit yet, so deleted
 * media's rows grow the artifact until the fingerprint changes.
 *
 * Memory is O(library): the loaded artifact plus, when a run has misses, one
 * joined copy (~2x the .bin at full-768 scale). That is acceptable for
 * hundreds of thousands of stills on a desktop-class instance; larger
 * deployments should shard the library.
 */
export function computeFingerprint(pack: EmbeddingPackDefinition, encoderKind: 'ort' | 'fake'): string {
  return Crypto.createHash('sha256')
    .update(
      JSON.stringify({
        id: pack.id,
        files: pack.files.map((file) => ({ name: file.name, sha256: file.sha256 })),
        preprocess: pack.preprocess,
        imageBatch: IMAGE_BATCH,
        textBatch: TEXT_BATCH,
        contextLength: pack.contextLength,
        dim: pack.dim,
        ort: onnxruntimeVersion(),
        // A TEST_MODE fake run's rows are pseudo-random placeholders, so they
        // can never satisfy a real run's cache.
        encoder: encoderKind,
      }),
    )
    .digest('hex');
}

function onnxruntimeVersion(): string {
  try {
    // A package.json read only, no library code is loaded at fingerprint time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const metadata = require('onnxruntime-node/package.json') as { version?: unknown };
    return typeof metadata.version === 'string' ? metadata.version : '';
  } catch {
    // Unreadable metadata should not break cache identity; the empty string
    // changes nothing about how uniquely the real inputs hash.
    return '';
  }
}

export interface LoadedEmbeddings {
  /** Hashes in stored order; `data` rows line up with this array. */
  hashes: string[];
  dims: number;
  /** Joined rows; row i lives at data[i * dims]. */
  data: Float32Array;
}

/** Per-hash row index: O(n) once, then O(1) lookups during scoring. */
export function embeddingsIndex(cache: LoadedEmbeddings): Map<string, number> {
  const index = new Map<string, number>();
  for (let row = 0; row < cache.hashes.length; row++) {
    index.set(cache.hashes[row], row);
  }
  return index;
}

/**
 * Loads the artifact written by saveEmbeddingCache. Missing artifact ->
 * undefined (nothing cached yet). A present artifact with a different
 * fingerprint, or a size that disagrees with its own metadata, throws —
 * both are corruption signals a resumable run must not paper over.
 */
export async function loadEmbeddingCache(
  pack: EmbeddingPackDefinition,
  fingerprint: string,
): Promise<LoadedEmbeddings | undefined> {
  const binPath = cacheBinPath(pack);
  const metaPath = cacheMetaPath(pack);
  if (!(await fileExists(binPath)) || !(await fileExists(metaPath))) {
    return undefined;
  }
  const meta = JSON.parse(await FS.promises.readFile(metaPath, 'utf8')) as {
    hashes: string[];
    dims: number;
    fingerprint: string;
  };
  if (meta.fingerprint !== fingerprint) {
    throw new Error(cachedMessage(pack, 'produced by a different configuration (fingerprint mismatch)'));
  }
  const buffer = await FS.promises.readFile(binPath);
  const expectedBytes = meta.hashes.length * meta.dims * 4;
  if (buffer.length !== expectedBytes) {
    throw new Error(cachedMessage(pack, `truncated (${buffer.length} bytes, expected ${expectedBytes})`));
  }
  return {
    hashes: meta.hashes,
    dims: meta.dims,
    data: new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4),
  };
}

/**
 * Writes the whole artifact atomically per file (temp name, then rename)
 * after an appending run. Rows are streamed so no second copy of the joined
 * matrix is materialised.
 */
export async function saveEmbeddingCache(
  pack: EmbeddingPackDefinition,
  fingerprint: string,
  { hashes, dims, rows }: { hashes: string[]; dims: number; rows: Float32Array[] },
): Promise<void> {
  // The TEST_MODE fake encoder never downloads a pack, so the directory the
  // artifact renames into does not exist yet on a first run.
  await FS.promises.mkdir(packDir(pack), { recursive: true });
  if (hashes.length !== rows.length) {
    throw new Error(`Embedding cache rows (${rows.length}) do not match hash list (${hashes.length})`);
  }
  // Validate before opening anything so a caller bug cannot leave partials.
  for (const [index, row] of rows.entries()) {
    if (row.length !== dims) {
      throw new Error(`Embedding row ${index} has ${row.length} dims, expected ${dims}`);
    }
  }
  const binPath = cacheBinPath(pack);
  const metaPath = cacheMetaPath(pack);
  const binPartial = `${binPath}.part`;
  const metaPartial = `${metaPath}.part`;

  try {
    await writeRows(FS.createWriteStream(binPartial), rows);
    await FS.promises.writeFile(metaPartial, JSON.stringify({ hashes, dims, fingerprint }));
    await FS.promises.rename(binPartial, binPath);
    await FS.promises.rename(metaPartial, metaPath);
  } catch (err: unknown) {
    for (const partial of [binPartial, metaPartial]) {
      try {
        await FS.promises.unlink(partial);
      } catch {
        // Not a file; leave whatever exists for diagnostics.
      }
    }
    throw err;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await FS.promises.access(path);
    return true;
  } catch {
    // Any access error (missing, unreadable) reads as "nothing cached".
    return false;
  }
}

function cacheBinPath(pack: EmbeddingPackDefinition): string {
  return Path.resolve(packDir(pack), 'embeddings.bin');
}

function cacheMetaPath(pack: EmbeddingPackDefinition): string {
  return Path.resolve(packDir(pack), 'embeddings.json');
}

/**
 * Streams the rows out with backpressure; Buffer.from aliases the typed
 * array's storage rather than copying it.
 */
async function writeRows(stream: FS.WriteStream, rows: Float32Array[]): Promise<void> {
  // One listener, one rejection: backpressure waits subscribe only to
  // 'drain', and a write failure rejects through this promise no matter where
  // it was noticed. The success path finishes with end(); failure paths
  // remove the .part files in saveEmbeddingCache's catch, so nothing is
  // destroyed here.
  const failed = new Promise<never>((_resolve, reject) => stream.once('error', reject));
  // The races below consume the rejection; this guard only stops an error
  // that arrives after a successful end from becoming an unhandled rejection.
  void failed.catch(() => undefined);
  for (const row of rows) {
    const buffer = Buffer.from(row.buffer, row.byteOffset, row.length * 4);
    if (!stream.write(buffer)) {
      // Backpressure: wait for the drain event before writing more.
      await Promise.race([failed, new Promise<void>((resolve) => stream.once('drain', resolve))]);
    }
  }
  await Promise.race([failed, new Promise<void>((resolve) => stream.end(resolve))]);
}

function cachedMessage(pack: EmbeddingPackDefinition, reason: string): string {
  // Only the artifact is stale: the (large) downloaded pack files stay valid.
  // Both names come from the same helpers the writer uses, so a rename cannot
  // leave the guidance pointing at a file that no longer exists.
  const binPath = cacheBinPath(pack);
  const metaPath = cacheMetaPath(pack);
  return `The ${pack.id} embedding cache is ${reason}; delete ${binPath} and ${metaPath} to rebuild it`;
}
