import FS from 'fs';
import PHash from 'phash2';
import Path from 'path';
import Types from '@vimtur/common';
import Util from 'util';

import { Database } from '../types';
import { ImportUtils } from './import-utils';
import { Indexer } from './indexer';
import { Scanner } from './scanner';
import { Transcoder } from './transcoder';
import { generateImageCloneMap } from './clone-map';
import Config from '../config';

type State = Types.Scanner.State;
type Status = Types.Scanner.Status;

export type StatusCallback = (status: Status) => void;

const THUMBNAIL_BATCH_SIZE = 8;
// Really tends to block up the worker threads if higher.
const MH_HASH_BATCH_SIZE = 2;

export class Importer {
  private status: Status;
  private database: Database;
  private callback?: StatusCallback;
  private indexer: Indexer;
  private transcoder: Transcoder;

  public constructor(database: Database, callback?: StatusCallback) {
    this.database = database;
    this.callback = callback;
    this.indexer = new Indexer(database);
    this.transcoder = new Transcoder(database);
    this.status = {
      state: 'IDLE',
      progress: {
        current: 0,
        max: 0,
      },
    };
  }

  public getStatus(): Status {
    return this.status;
  }

  public async generateCloneMap(): Promise<void> {
    this.setState('CLONE_MAP');
    try {
      // First expire any old ones.
      await this.database.resetClones(Math.floor(Date.now() / 1000) - Config.get().maxCloneAge);
      // Now find all phashed
      const images = await this.database.subsetFields(
        { type: 'still', phashed: true },
        { phash: 1, hash: 1, clones: 1 },
      );

      const parsed = images.map(image => {
        return {
          hash: image.hash,
          phash: Buffer.from(image.phash!, 'base64'),
          clones: image.clones,
        };
      });

      console.log(`Generating clone map for ${images.length} images`);

      await generateImageCloneMap(this.database, parsed, progress => {
        this.status.progress = progress;
        this.update();
      });
    } catch (err) {
      console.error('Error generating clone map.', err);
      throw err;
    } finally {
      this.setState('IDLE');
    }
  }

  public async calculatePerceuptualHashes(): Promise<void> {
    this.setState('CALCULATING_PHASHES');
    console.log('Generating perceptual hashses...');
    try {
      const mediaList = await this.database.subset({
        // For now just do still. Video takes a long time and is questionably accurate.
        // Eg videos of different length not quite right.
        type: 'still',
        indexed: true,
        corrupted: false,
        phashed: false,
      });
      this.status.progress = {
        current: 0,
        max: mediaList.length,
      };

      while (mediaList.length > 0) {
        // Do them in batches of like 8, makes it a bit faster.
        await Promise.all(
          mediaList.splice(0, MH_HASH_BATCH_SIZE).map(async hash => {
            try {
              const media = await this.database.getMedia(hash);
              if (!media) {
                console.warn(`Couldn't find media to generate perceptual hash: ${hash}`);
                return;
              }

              console.debug(`Generating pHash for ${media.hash} - ${media.absolutePath}`);
              const hashBuffer = await this.getPerceptualHash(media);
              await this.database.saveMedia(media.hash, { phash: hashBuffer.toString('base64') });
            } catch (err) {
              console.log(`Error generating perceuptual hash for ${hash}.`, err);
            }
            this.status.progress.current++;
            this.update();
          }),
        );
      }
    } catch (err) {
      console.error('Error generating perceuptual hashes.', err);
      throw err;
    } finally {
      this.setState('IDLE');
    }
  }

  public async cacheKeyframes(): Promise<void> {
    if (!Config.get().transcoder.enablePrecachingKeyframes) {
      console.debug('Skipping keyframe precaching.');
      return;
    }

    this.setState('KEYFRAME_CACHING');
    console.log('Precaching keyframes...');
    console.time('Keyframe Precache Time');
    try {
      const mediaList = await this.database.subset({ type: ['video'], indexed: true });
      for (let i = 0; i < mediaList.length; i++) {
        this.status.progress = { current: i, max: mediaList.length };
        this.update();

        const media = await this.database.getMedia(mediaList[i]);
        if (!media) {
          console.log('Unexpectedly couldnt find media', mediaList[i]);
          continue;
        }
        if (!media.metadata) {
          console.log('Skipping precache for non-indexed media', mediaList[i]);
          continue;
        }

        let generateSegments = !media.metadata.segments;
        if (generateSegments && media.metadata.qualityCache) {
          const desired = ImportUtils.getMediaDesiredQualities(media);
          let hasAll = true;
          // Check if it's cached at every desired quality, if it is then don't
          // bother precaching.
          for (const quality of desired) {
            if (!media.metadata.qualityCache.includes(quality.quality)) {
              hasAll = false;
              break;
            }
          }
          if (hasAll) {
            generateSegments = false;
          }
        }

        if (generateSegments) {
          try {
            const segments = await ImportUtils.generateSegments(media);
            await this.database.saveMedia(media.hash, {
              metadata: {
                segments,
              },
            });
          } catch (err) {
            console.warn('Failed to cache segments', media.hash, err);
          }
        }
      }
    } catch (err) {
      console.error('Error precaching keyframes', err);
      throw err;
    } finally {
      console.timeEnd('Keyframe Precache Time');
      this.setState('IDLE');
    }
  }

  public async scan(): Promise<void> {
    this.setState('SCANNING');
    console.log('Scanning...');
    console.time('Scan Time');
    try {
      const files = await Scanner.getFileList();
      const mediaList = await this.database.subsetFields({}, { path: 1 });
      const normalisedPaths: string[] = [];
      for (const media of mediaList) {
        normalisedPaths.push(media.path);
      }
      this.status.scanResults = await Scanner.filterNewAndMissing(normalisedPaths, files);
    } catch (err) {
      console.error('Error scanning library.', err);
      throw err;
    } finally {
      console.timeEnd('Scan Time');
      this.setState('IDLE');
    }
  }

  public async rehash(): Promise<void> {
    this.setState('REHASHING');
    console.log('Rehashing...');
    console.time('Rehash Time');
    const cachePath = Path.resolve(Config.get().cachePath);
    try {
      const files = await this.database.subset({});
      for (let i = 0; i < files.length; i++) {
        const media = await this.database.getMedia(files[i]);
        if (!media) {
          console.warn(`Couldn't find media to rehash: ${files[i]}`);
          continue;
        }
        const hash = await ImportUtils.hash(media.absolutePath);
        if (hash !== media.hash) {
          console.warn(`Hash changed for ${media.absolutePath}`);
          // Rename the video cache folder, if it's a video.
          if (media.type === 'video') {
            try {
              await Util.promisify(FS.rename)(
                Path.resolve(cachePath, media.hash),
                Path.resolve(cachePath, hash),
              );
            } catch (err) {
              console.warn('Failed to rename video', err);
              await this.database.saveMedia(media.hash, { metadata: { qualityCache: [] } });
            }
          }
          try {
            // Rename the thumbnail.
            await Util.promisify(FS.rename)(
              Path.resolve(cachePath, 'thumbnails', `${media.hash}.png`),
              Path.resolve(cachePath, 'thumbnails', `${hash}.png`),
            );
          } catch (err) {
            // If thumbnails can't be moved, because say they're not generated then it's not the end of the world.
            console.warn('Failed to rename thumbnail during rehash', err);
            await this.database.saveMedia(media.hash, { thumbnail: false });
          }
        }
        await this.database.saveMedia(media.hash, { hash });
        this.status.progress = { current: i, max: files.length };
        this.update();
      }
    } catch (err) {
      console.error('Error rehashing library.', err);
      throw err;
    } finally {
      console.timeEnd('Rehash Time');
      this.setState('IDLE');
    }
  }

  public async index(): Promise<void> {
    // If a scan hasn't been run then first do that before indexing.
    if (!this.status.scanResults) {
      await this.scan();
    }
    if (!this.status.scanResults) {
      throw new Error('Cannot index because scanResults are undefined after scanning');
    }

    this.setState('INDEXING');
    console.log('Indexing...');
    console.time('Index Time');
    try {
      await this.indexer.indexFiles(this.status.scanResults.newPaths, (current, max) => {
        this.status.progress = { current, max };
        this.update();
      });
      this.status.scanResults.newPaths = [];
      this.update();
    } catch (err) {
      console.error('Error indexing library.', err);
      throw err;
    } finally {
      console.timeEnd('Index Time');
      this.setState('IDLE');
    }
  }

  public async verifyThumbnails(): Promise<void> {
    this.setState('VERIFY_THUMBNAILS');
    console.log('Verifying thumbnails...');
    try {
      const withThumbnails = await this.database.subset({ thumbnail: true });
      this.status.progress = {
        current: 0,
        max: withThumbnails.length,
      };
      while (withThumbnails.length > 0) {
        await Promise.all(
          withThumbnails.splice(0, THUMBNAIL_BATCH_SIZE).map(async hash => {
            const media = await this.database.getMedia(hash);
            if (!media) {
              return;
            }
            const path = this.transcoder.getThumbnailPath(media);
            const exists = await ImportUtils.exists(path);
            if (!exists) {
              console.warn(`${media.absolutePath} missing thumbnail`);
              await this.database.saveMedia(media.hash, { thumbnail: false });
            }
            this.status.progress.current++;
          }),
        );
        this.update();
      }
    } catch (err) {
      console.error('Error verifying thumbnails', err);
      throw err;
    } finally {
      this.setState('IDLE');
    }
  }

  public async thumbnails(): Promise<void> {
    this.setState('THUMBNAILS');
    console.log('Generating thumbnails...');
    try {
      const withoutThumbnails = await this.database.subset({ thumbnail: false, corrupted: false });
      this.status.progress = {
        current: 0,
        max: withoutThumbnails.length,
      };
      console.log(`${withoutThumbnails.length} media without thumbnails.`);
      while (withoutThumbnails.length > 0) {
        // Do them in batches of like 8, makes it a bit faster.
        await Promise.all(
          withoutThumbnails.splice(0, THUMBNAIL_BATCH_SIZE).map(async hash => {
            try {
              const media = await this.database.getMedia(hash);
              if (!media) {
                console.warn(`Couldn't find media to generate thumbnail: ${hash}`);
                return;
              }
              const path = media.absolutePath;
              console.log(`Generating thumbnail for ${path}...`);
              switch (media.type) {
                case 'video':
                  await this.transcoder.createVideoThumbnail(media);
                  break;
                case 'still': // Fallthrough
                case 'gif':
                  await this.transcoder.createImageThumbnail(media);
                  break;
                default:
                  console.warn('Unhandled media type', media);
                  return;
              }

              try {
                await this.database.saveMedia(media.hash, { thumbnail: true });
              } catch (err) {
                console.log('Failed to save media thumbnail state.', err, media);
              }
            } catch (err) {
              console.log(`Error generating thumbnail for ${hash}.`, err);
              await this.database.saveMedia(hash, { corrupted: true });
            }
            this.status.progress.current++;
            this.update();
          }),
        );
      }
    } catch (err) {
      console.error('Error generating thumbnails.', err);
      throw err;
    } finally {
      this.setState('IDLE');
    }
  }

  public async cache(): Promise<void> {
    if (!Config.get().transcoder.enableVideoCaching) {
      console.debug('Skipping cache generation: Caching disabled.');
      return;
    }
    this.setState('CACHING');
    console.log('Caching...');
    console.time('Cache Time');
    try {
      await this.transcoder.transcodeSet(
        await this.database.subset({ type: ['video'], corrupted: false }),
        (current, max) => {
          this.status.progress = { current, max };
          this.update();
        },
      );
    } catch (err) {
      console.error('Error caching library.', err);
      throw err;
    } finally {
      console.timeEnd('Cache Time');
      this.setState('IDLE');
    }
  }

  public async findRedundantCaches(): Promise<Record<string, number[]>> {
    const redundantMap: Record<string, number[]> = {};
    for (const hash of await this.database.subset({ type: ['video'], corrupted: false })) {
      const media = await this.database.getMedia(hash);
      if (!media) {
        console.warn(`Couldn't find media to check redundant caches: ${hash}`);
        continue;
      }

      if (!media.metadata || !media.metadata.qualityCache) {
        continue;
      }
      const desiredCaches = ImportUtils.getMediaDesiredQualities(media);
      const actualCaches = media.metadata.qualityCache;

      const redundant = ImportUtils.getRedundanctCaches(desiredCaches, actualCaches);
      if (redundant.length) {
        redundantMap[hash] = redundant;
      }
    }
    return redundantMap;
  }

  private getPerceptualHash(media: Types.Media): Promise<Buffer> {
    switch (media.type) {
      case 'still':
        return PHash.getMhImageHash(media.absolutePath);
      case 'video':
        return PHash.getDctVideoHash(media.absolutePath);
      default:
        throw new Error(`Unsupported type for phash ${media.type}`);
    }
  }

  private setState(state: State): void {
    if (this.status.state !== 'IDLE' && state !== 'IDLE') {
      throw new Error(`Task already in progress ${this.status.state}, cannot switch to ${state}`);
    }
    switch (state) {
      case 'IDLE':
        this.status.progress = {
          current: 0,
          max: 0,
        };
      // Fallthrough.
      case 'SCANNING':
      case 'INDEXING':
      case 'CACHING':
      case 'REHASHING':
      case 'THUMBNAILS':
      case 'VERIFY_THUMBNAILS':
      case 'KEYFRAME_CACHING':
      case 'CALCULATING_PHASHES':
      case 'CLONE_MAP':
        this.status.state = state;
        break;
      default:
        throw new Error(`Attempted to switch to invalid state: ${state}`);
    }
    this.update();
  }

  private update(): void {
    if (this.callback) {
      this.callback(this.status);
    }
  }
}
