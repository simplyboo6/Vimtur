import Crypto from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, open, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import Path from 'node:path';

import { ImportUtils } from '../../../cache/import-utils';
import Config from '../../../config';

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
 * Deleted (or rehashed) media is pruned from the json index only
 * (removeCachedEmbeddings), so `embeddings.bin` may hold rows nothing points
 * at. Those unreachable rows are reclaimed lazily: the next save rewrites the
 * bin from the current hash list, and a run whose stills are all cached does
 * not save at all, so garbage only grows until some run has a miss. Measured
 * size: one 768-wide Float32 row is ~3 KB per still, and the json metadata
 * adds ~67 B per hash.
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
 * Sidecar metadata for `embeddings.bin`. Positional: hashes[i] is the hash
 * whose row lives at physical row rows[i] of the bin, so only the row indices
 * listed here are ever read. The bin is append-only between saves, so rows may
 * be non-contiguous and a tail of unreachable garbage rows is allowed: a
 * delete rewrites this json alone (removeCachedEmbeddings) without touching
 * the bin, and the next save reclaims the garbage by rewriting the whole bin.
 */
interface EmbeddingCacheMeta {
  /** Hashes in stored order; the loaded matrix's rows line up with this. */
  hashes: string[];
  /** Row width, in floats. */
  dims: number;
  fingerprint: string;
  /**
   * Physical row index of each hash, parallel to `hashes`. A freshly written
   * bin is contiguous, so a save always writes the identity (row i = i).
   * Omitted by caches written before row indexing existed: those are
   * positional, so a missing `rows` means identity.
   */
  rows?: number[];
}

/**
 * Loads the artifact written by saveEmbeddingCache. Missing artifact ->
 * undefined (nothing cached yet). A present artifact with a different
 * fingerprint or dims, or a metadata row that lies outside the bin, throws —
 * all are corruption signals a resumable run must not paper over. Padding
 * rows past the last listed one are not corruption: they are what a delete
 * leaves behind until the next save rewrites the bin.
 */
export async function loadEmbeddingCache(
  pack: EmbeddingPackDefinition,
  fingerprint: string,
): Promise<LoadedEmbeddings | undefined> {
  const binPath = cacheBinPath(pack);
  const metaPath = cacheMetaPath(pack);
  if (!(await ImportUtils.exists(binPath)) || !(await ImportUtils.exists(metaPath))) {
    return undefined;
  }
  const meta = JSON.parse(await readFile(metaPath, 'utf8')) as EmbeddingCacheMeta;
  if (meta.fingerprint !== fingerprint) {
    throw new Error(cachedMessage(pack, 'produced by a different configuration (fingerprint mismatch)'));
  }
  if (meta.dims !== pack.dim) {
    throw new Error(cachedMessage(pack, `written with ${meta.dims} dims, the pack has ${pack.dim}`));
  }
  // Pre-row-index caches are positional; synthesising the identity keeps them
  // readable and lets removeCachedEmbeddings compact them into a row list.
  const rows = meta.rows ?? meta.hashes.map((_, row) => row);
  if (rows.length !== meta.hashes.length) {
    throw new Error(cachedMessage(pack, 'corrupt (its row list does not match its hash list)'));
  }
  const buffer = await readFile(binPath);
  const rowBytes = meta.dims * 4;
  for (const [index, row] of rows.entries()) {
    if (!Number.isInteger(row) || row < 0) {
      throw new Error(cachedMessage(pack, `corrupt (invalid row index ${row} for hash ${meta.hashes[index]})`));
    }
    if ((row + 1) * rowBytes > buffer.length) {
      throw new Error(cachedMessage(pack, `truncated (row ${row} is outside the bin's ${buffer.length} bytes)`));
    }
  }
  // A freshly saved bin is contiguous and its row list is the identity, the
  // overwhelmingly common case. Return a view over the file's bytes rather
  // than copying O(library) floats: consumers only read `data` (scoring takes
  // subarray views, and embedStills copies it into its own joined matrix when
  // there are misses), so sharing the read buffer is safe. The exact length
  // check rejects an appended garbage tail, which needs the dense copy below.
  const identityRows = rows.every((row, index) => row === index);
  if (identityRows && buffer.length === meta.hashes.length * rowBytes) {
    return {
      hashes: meta.hashes,
      dims: meta.dims,
      data: new Float32Array(buffer.buffer, buffer.byteOffset, meta.hashes.length * meta.dims),
    };
  }
  // Dense copy in hash order: callers (scoring, embedStills) only ever address
  // rows by position in `hashes`, so physical row numbers stay private here.
  const data = new Float32Array(meta.hashes.length * meta.dims);
  const source = new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 4));
  for (const [index, row] of rows.entries()) {
    data.set(source.subarray(row * meta.dims, (row + 1) * meta.dims), index * meta.dims);
  }
  return { hashes: meta.hashes, dims: meta.dims, data };
}

/**
 * Tail of the cache-mutation queue. Saves rewrite the bin and its index,
 * prunes rewrite the index alone; if they interleave, a prune computed from the
 * pre-save index would point its surviving hashes at rows of a bin that the
 * save has since renumbered — silently wrong vectors, not just garbage. Both
 * paths therefore run one at a time.
 */
let cacheWriteTail: Promise<void> = Promise.resolve();

function enqueueCacheWrite<T>(operation: () => Promise<T>): Promise<T> {
  // Chain from the settled tail so one failed write neither rejects the next
  // call nor is silently dropped: each caller still sees its own rejection
  // while the queue stays usable.
  const next = cacheWriteTail.then(operation, operation);
  cacheWriteTail = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Writes the whole artifact atomically per file (temp name, then rename)
 * after an appending run. Rows are streamed so no second copy of the joined
 * matrix is materialised. This also physically compacts the bin: it is
 * rewritten from the CURRENT hash list, so rows that earlier deletes left
 * unreachable are dropped here (a run whose stills are all cached saves
 * nothing, so compaction is lazy by design).
 */
export function saveEmbeddingCache(
  pack: EmbeddingPackDefinition,
  fingerprint: string,
  rowsToWrite: { hashes: string[]; dims: number; rows: Float32Array[] },
): Promise<void> {
  return enqueueCacheWrite(() => writeEmbeddingCache(pack, fingerprint, rowsToWrite));
}

async function writeEmbeddingCache(
  pack: EmbeddingPackDefinition,
  fingerprint: string,
  { hashes, dims, rows }: { hashes: string[]; dims: number; rows: Float32Array[] },
): Promise<void> {
  // The TEST_MODE fake encoder never downloads a pack, so the directory the
  // artifact renames into does not exist yet on a first run.
  await mkdir(packDir(pack), { recursive: true });
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
    // One open handle per file: the bin is streamed row by row, then closed
    // before the renames so partials can be unlinked on any failure below.
    const binHandle = await open(binPartial, 'w');
    try {
      await writeRows(binHandle, rows);
    } finally {
      await binHandle.close();
    }
    // The writer emits exactly these rows in this order, so the freshly
    // written bin is contiguous and the row list is the identity. Writing it
    // explicitly keeps old caches (no `rows`) distinguishable from damaged
    // ones and lets a delete compact the index without touching the bin.
    const metaRows = hashes.map((_, row) => row);
    await writeFile(metaPartial, JSON.stringify({ hashes, dims, fingerprint, rows: metaRows }));
    await rename(binPartial, binPath);
    await rename(metaPartial, metaPath);
  } catch (err: unknown) {
    for (const partial of [binPartial, metaPartial]) {
      try {
        await unlink(partial);
      } catch {
        // Not a file; leave whatever exists for diagnostics.
      }
    }
    throw err;
  }
}

function cacheBinPath(pack: EmbeddingPackDefinition): string {
  return Path.resolve(packDir(pack), 'embeddings.bin');
}

/**
 * Drops `hashes` from every pack's embedding index under the shared autotag
 * cache directory. Called when media is deleted or rehashed: unlike the
 * per-hash files deleteCache removes, one artifact holds rows for the whole
 * library, so its index must lose the hash or that row becomes unreachable
 * garbage until the next save rewrites the bin.
 *
 * Only the json is rewritten (atomically, tmp + rename), never the bin: the
 * loader reads listed rows only, so a crash between the two leaves at worst a
 * json that still lists the removed hash, which the next delete drops again.
 * Hashes that no pack lists are a no-op, so a rehash of media never embedded
 * writes nothing. A corrupt or unreadable index is skipped with a warning
 * rather than allowed to block a media deletion: the artifact is derived data,
 * and the next embedding run fails loudly with the fix-it message.
 *
 * Removals are coalesced: every call adds to a pending set and the first call
 * enqueues one flush through the same cache-mutation queue the saves use.
 * Bulk delete paths (DELETE-MISSING runs with parallel: 8) and whole-library
 * REHASH otherwise pay a full per-pack read-modify-write per hash, O(index)
 * each; the set turns a whole burst into one prune per pack. Queue order still
 * makes prune-before-save safe: operations run strictly in enqueue order and
 * the flush reads the index when it runs, so a flush queued ahead of a save
 * prunes the pre-save row list before the save renumbers it, never after.
 *
 * The returned promise covers the FIRST flush (including hashes added before
 * it starts), not the full drain: a caller only needs its own hash removed
 * once, and later batches queue their own flush behind it. The two callers
 * (deleteMedia and rehash) await per item and never loop waiting for a drain.
 */
let pendingRemovals = new Set<string>();
let pendingRemovalFlush: Promise<void> | undefined;

export function removeCachedEmbeddings(hashes: string[]): Promise<void> {
  for (const hash of hashes) {
    pendingRemovals.add(hash);
  }
  if (!pendingRemovalFlush) {
    pendingRemovalFlush = enqueueCacheWrite(flushPendingRemovals);
  }
  return pendingRemovalFlush;
}

async function flushPendingRemovals(): Promise<void> {
  // Snapshot and reset before any await: hashes added while this prune runs
  // must start a new flush rather than being dropped from the snapshot.
  const batch = [...pendingRemovals];
  pendingRemovals = new Set();
  pendingRemovalFlush = undefined;
  await pruneCachedEmbeddings(batch);
}

async function pruneCachedEmbeddings(hashes: string[]): Promise<void> {
  const removeSet = new Set(hashes);
  if (removeSet.size === 0) {
    return;
  }
  const autotagDir = Path.resolve(Config.get().cachePath, 'autotag');
  let entries: Dirent[];
  try {
    entries = await readdir(autotagDir, { withFileTypes: true });
  } catch (errUnknown: unknown) {
    // No autotag directory means nothing has ever been embedded.
    if (isMissingFile(errUnknown)) {
      return;
    }
    throw errUnknown;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const metaPath = Path.resolve(autotagDir, entry.name, 'embeddings.json');
    const meta = await readCacheMeta(metaPath);
    if (!meta) {
      continue;
    }
    const rows = meta.rows ?? meta.hashes.map((_, row) => row);
    const keptHashes: string[] = [];
    const keptRows: number[] = [];
    for (const [index, hash] of meta.hashes.entries()) {
      if (!removeSet.has(hash)) {
        keptHashes.push(hash);
        keptRows.push(rows[index]);
      }
    }
    if (keptHashes.length === meta.hashes.length) {
      continue;
    }
    // Surviving rows keep their physical positions, which may now be
    // non-contiguous; only the next save renumbers them by rewriting the bin.
    const metaPartial = `${metaPath}.part`;
    try {
      await writeFile(
        metaPartial,
        JSON.stringify({ hashes: keptHashes, dims: meta.dims, fingerprint: meta.fingerprint, rows: keptRows }),
      );
      await rename(metaPartial, metaPath);
    } catch (err: unknown) {
      try {
        await unlink(metaPartial);
      } catch {
        // Not a file; leave whatever exists for diagnostics.
      }
      throw err;
    }
  }
}

/** Reads one pack's index, or undefined when it is missing or unparseable. */
async function readCacheMeta(metaPath: string): Promise<EmbeddingCacheMeta | undefined> {
  let raw: string;
  try {
    raw = await readFile(metaPath, 'utf8');
  } catch (errUnknown: unknown) {
    if (isMissingFile(errUnknown)) {
      return undefined;
    }
    throw errUnknown;
  }
  try {
    const meta = JSON.parse(raw) as EmbeddingCacheMeta;
    if (!Array.isArray(meta.hashes) || typeof meta.dims !== 'number' || typeof meta.fingerprint !== 'string') {
      console.warn(`Skipping the embedding index at ${metaPath}: unexpected shape`);
      return undefined;
    }
    // A missing row list is the legacy positional format and stays valid; a
    // present one must address exactly these hashes. Skipping a corrupt list
    // (rather than rewriting the index with it) means the next load still
    // fails loudly with its own corruption message instead of the prune
    // producing a plausible-looking index that cannot be read.
    if (
      meta.rows !== undefined &&
      (!Array.isArray(meta.rows) ||
        meta.rows.length !== meta.hashes.length ||
        !meta.rows.every((row) => Number.isInteger(row) && row >= 0))
    ) {
      console.warn(`Skipping the embedding index at ${metaPath}: unexpected row list`);
      return undefined;
    }
    return meta;
  } catch {
    console.warn(`Skipping the embedding index at ${metaPath}: not valid JSON`);
    return undefined;
  }
}

function isMissingFile(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT';
}

function cacheMetaPath(pack: EmbeddingPackDefinition): string {
  return Path.resolve(packDir(pack), 'embeddings.json');
}

/**
 * Writes every row through one file handle, awaiting each write. That is the
 * FileHandle form of the stream the writer used to pass: at most one row is in
 * flight, so memory stays O(one row) and a failed write rejects immediately
 * (a short write is retried until the row is out). Buffer.from aliases the
 * typed array's storage rather than copying it. No fsync is issued: like the
 * stream's end(), close() only flushes to the OS before the rename.
 */
async function writeRows(handle: FileHandle, rows: Float32Array[]): Promise<void> {
  for (const row of rows) {
    const buffer = Buffer.from(row.buffer, row.byteOffset, row.length * 4);
    let written = 0;
    while (written < buffer.length) {
      // position null: continue at the handle's current position, which the
      // previous awaited write advanced.
      const { bytesWritten } = await handle.write(buffer, written, buffer.length - written, null);
      written += bytesWritten;
    }
  }
}

function cachedMessage(pack: EmbeddingPackDefinition, reason: string): string {
  // Only the artifact is stale: the (large) downloaded pack files stay valid.
  // Both names come from the same helpers the writer uses, so a rename cannot
  // leave the guidance pointing at a file that no longer exists.
  const binPath = cacheBinPath(pack);
  const metaPath = cacheMetaPath(pack);
  return `The ${pack.id} embedding cache is ${reason}; delete ${binPath} and ${metaPath} to rebuild it`;
}
