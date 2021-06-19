import FS from 'fs';
import Util from 'util';

import { setup as setupDb } from '../database';
import Config from '../config';
import type { DumpFile } from '../types';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    throw new Error('Set file to output to');
  }

  console.log(`Saving to ${file}`);

  // For piping output push logs to error.
  console.log('Connecting to database...');
  const db = await setupDb();
  console.log('Applying config overlay from database...');
  const userConfigOverlay = await db.getUserConfig();
  Config.setUserOverlay(userConfigOverlay);

  const output: DumpFile = {
    tags: await db.getTags(),
    media: [],
    actors: await db.getActors(),
    config: userConfigOverlay,
    version: 4,
  };
  // Save tags
  const map = await db.subset({});
  for (const hash of map) {
    const media = await db.getMedia(hash);
    if (!media) {
      console.warn(`Could not fetch media (removed from set): ${hash}`);
      continue;
    }
    delete (media as any).absolutePath;
    delete (media as any)._id;
    output.media.push(media);
  }

  await db.close();

  console.log(`Saving database to ${file}`);
  await Util.promisify(FS.writeFile)(file, JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
