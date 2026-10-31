import Crypto from 'node:crypto';
import FS from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface FileDefinition {
  url: string;
  sha256: string;
}

// Blob-model downloads: the response is streamed into the partial file and
// hashed on the way through, so nothing holds two copies of a 178MB model in
// memory. Generous because the largest registry model is ~180MB on slow links.
const HEAD_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 600_000;

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
