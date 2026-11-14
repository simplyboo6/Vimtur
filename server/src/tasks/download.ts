import Crypto from 'node:crypto';
import FS from 'node:fs';
import { mkdir, rename, stat } from 'node:fs/promises';
import Path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface FileDefinition {
  url: string;
  sha256: string;
}

/**
 * One downloadable file of a model pack: flat files downloaded straight onto
 * their own names inside the pack directory (no archive to unpack).
 */
export interface PackFile {
  /** File name inside the pack directory, e.g. 'image.ort'. */
  name: string;
  url: string;
  sha256: string;
  /** Size in bytes, used by the cached-file sanity check. */
  size: number;
}

// Blob-model downloads: the response is streamed into the partial file and
// hashed on the way through, so nothing holds two copies of a 178MB model in
// memory. Generous because the largest registry model is ~180MB on slow links.
const HEAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;

/**
 * Total-time budget for one pack file, shared by every flat-file pack: 30
 * minutes, sized for the largest pack file (the 616MiB BLIP decoder) at a
 * ~350KB/s slow-link floor. A total budget (not an idle one) re-downloads from
 * zero on overrun; packs are a large one-off cost, so that is accepted in
 * exchange for keeping the shared mechanic simple.
 */
export const PACK_DOWNLOAD_TIMEOUT_MS = 1_800_000;

type NodeCallback = (err?: Error | null, data?: Buffer) => void;

/**
 * Streams the download into `partialPath` while hashing it, then verifies the
 * definition's sha256. On any failure the partial name is removed so nothing
 * incomplete is left for a later run to mistake for file data.
 */

export async function downloadAndVerifyFile(
  file: FileDefinition,
  partialPath: string,
  timeoutMs: number = DOWNLOAD_TIMEOUT_MS,
): Promise<void> {
  try {
    const response = await fetch(file.url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      // Reading the error body is what lets the process log describe it.
      const text = await response.text();
      throw new Error(`File download failed: ${response.status}: ${text}`);
    }
    if (!response.body) {
      throw new Error('File download failed: response has no body');
    }
    const hasher = new HashingStream();
    await pipeline(
      Readable.fromWeb(response.body as unknown as import('stream/web').ReadableStream),
      hasher,
      FS.createWriteStream(partialPath),
    );
    const hash = hasher.digest();
    if (hash !== file.sha256) {
      throw new Error(`File download hash mismatch: expected ${file.sha256} got ${hash}`);
    }
  } catch (err: unknown) {
    // Any failure (aborted read, disk full, hash mismatch) must not leave the
    // partial name behind for a later run to mistake for file data. Only the
    // two shapes the partial can have are removed: an actual file, or the
    // empty directory a failed open can leave behind (see the write-failure
    // unit test). Nothing is ever deleted recursively, so even a corrupted
    // path cannot take out directory contents by mistake.
    try {
      FS.unlinkSync(partialPath);
    } catch {
      try {
        FS.rmdirSync(partialPath);
      } catch {
        // Neither a file nor an empty directory; leave it for diagnostics.
      }
    }
    throw err;
  }
}

/**
 * Checks whether a previously downloaded file of the same reported size exists
 * at `destination`. An unreachable source with a present file counts as cached:
 * the feature is offline-after-first-run, so a same-sized cached file is assumed
 * correct.
 */
export async function isFileCached(destination: string, url: string): Promise<boolean> {
  if (!FS.existsSync(destination)) {
    return false;
  }
  const size = FS.statSync(destination).size;
  if (size === 0) {
    return false;
  }
  try {
    // Verified against the registry URLs: the Hugging Face -> CDN redirect
    // target answers HEAD with the model's Content-Length, so the cached
    // size is comparable across runs.
    return (await remoteSize(url)) === size;
  } catch {
    // An unreachable source with a present model is fine: the feature is
    // offline-after-first-run, so a same-sized cached file is assumed correct.
    return true;
  }
}

async function remoteSize(url: string): Promise<number | undefined> {
  // HEAD only; the body is never used.
  const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`File size request failed: ${res.status}`);
  }
  const length = res.headers.get('content-length');
  return length ? Number(length) : undefined;
}

/** True when `path` exists with exactly `size` bytes; a stat only, never a read. */
export async function hasExpectedSize(path: string, size: number): Promise<boolean> {
  try {
    return (await stat(path)).size === size;
  } catch {
    // A missing file is just "not cached yet".
    return false;
  }
}

/**
 * Ensures every file is present at its declared size in `cacheDir`, downloading
 * the rest. Per file: an interrupted download can only ever leave a `.part`
 * name behind, never a complete-looking file. A failed first download may
 * leave an empty pack directory behind, which the pack's isPackCached size
 * check treats as not cached.
 */
export async function ensurePackFilesDownloaded(
  cacheDir: string,
  files: readonly PackFile[],
  timeoutMs: number,
): Promise<void> {
  await mkdir(cacheDir, { recursive: true });
  for (const file of files) {
    const destination = Path.resolve(cacheDir, file.name);
    // Skip files that are already locally right (partially complete packs).
    // The sha256 is verified at download time, so the declared size is what
    // guards offline reuse; a size-mismatched file is re-downloaded when
    // online and fails honestly when offline rather than feeding a truncated
    // model to the encoder. No HEAD probe: a remote size cannot be trusted
    // over the size declared by the verified definition.
    if (await hasExpectedSize(destination, file.size)) {
      continue;
    }
    const partial = `${destination}.part`;
    await downloadAndVerifyFile({ url: file.url, sha256: file.sha256 }, partial, timeoutMs);
    await rename(partial, destination);
    // The pack directory is named after the pack id, so this names the pack.
    console.log(`Pack file downloaded: ${Path.basename(cacheDir)}/${file.name}`);
  }
}

// Streams the body hashing every chunk in flight, without materialising the
// whole body.
class HashingStream extends Transform {
  private readonly hash = Crypto.createHash('sha256');

  public override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: NodeCallback): void {
    this.hash.update(chunk);
    callback(null, chunk);
  }

  public digest(): string {
    return this.hash.digest('hex');
  }
}
