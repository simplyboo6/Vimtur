import Crypto from 'crypto';
import FS from 'fs';
import Util from 'util';

// Bytes to read from start and end of file.
const CHUNK_SIZE = 64 * 1024;

// This generates SubDB compatible hashes. http://thesubdb.com/api/
export async function createHash(path: string): Promise<string> {
  const fd = await Util.promisify(FS.open)(path, 'r');
  const buffer = Buffer.alloc(CHUNK_SIZE * 2);
  const [startReadResult, statResult] = await Promise.all([
    Util.promisify(FS.read)(fd, buffer, 0, CHUNK_SIZE, 0),
    Util.promisify(FS.stat)(path),
  ]);

  let total = startReadResult.bytesRead;
  const endStart = statResult.size - CHUNK_SIZE;
  if (endStart <= 0) {
    buffer.copy(buffer, startReadResult.bytesRead, 0);
  } else {
    const endReadResult = await Util.promisify(FS.read)(
      fd,
      buffer,
      startReadResult.bytesRead,
      CHUNK_SIZE,
      endStart,
    );
    total += endReadResult.bytesRead;
  }
  await Util.promisify(FS.close)(fd);

  const hash = Crypto.createHash('md5');
  hash.update(buffer.slice(0, total));
  return hash.digest().toString('hex');
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) {
    throw new Error('No file specified');
  }

  console.log(`Hashing ${file}...`);
  createHash(file)
    .then((hash) => console.log(hash))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
