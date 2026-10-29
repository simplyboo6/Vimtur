import FS from 'fs';
import Path from 'path';

import type { Downloader } from '../../types';

interface DownloaderLoader {
  getDownloader: () => Downloader | Downloader[];
}

type DownloaderLoaderPartial = Partial<DownloaderLoader>;

function getDownloaderLoaders(dir: string): DownloaderLoader[] {
  return FS.readdirSync(dir, { encoding: 'utf8' })
    .filter((file) => file.endsWith('.js') && file !== Path.basename(__filename))
    .map((file) => {
      try {
        // Downloader loaders are runtime files from the downloaders
        // directory, not build-time dependencies, so require() is the load
        // mechanism.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const loader = require(`${dir}/${file}`) as DownloaderLoaderPartial;
        if (!loader.getDownloader) {
          // Not a task loader.
          return undefined;
        }
        return loader as DownloaderLoader;
      } catch (err) {
        console.warn(`Failed to load downloader: ${file}`, err);
        return undefined;
      }
    })
    .filter((loader) => loader !== undefined);
}

const downloaderLoaders = getDownloaderLoaders(__dirname);

export function getDownloaders(): Downloader[] {
  return (
    downloaderLoaders
      .map((loader) => {
        const downloaders = loader.getDownloader();
        return Array.isArray(downloaders) ? downloaders : [downloaders];
      })
      // Map 2d array to 1d.
      .reduce((acc, val) => acc.concat(val), [])
      .filter((task) => task !== undefined)
  );
}
