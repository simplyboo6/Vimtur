import FS from 'fs';
import Path from 'path';

import type { Configuration } from '@vimtur/common';
import DeepMerge from 'deepmerge';
import PathIsInside from 'path-is-inside';
import StripJsonComments from 'strip-json-comments';

import { Validator } from './utils/validator';

function mapEnv(env: string, obj: Record<string, unknown>, dest: string): void {
  // Single local read: without noUncheckedIndexedAccess the type lies that
  // process.env[env] is always a string, so a non-null assertion here is
  // flagged as unnecessary by the lint rule — but it can be undefined at
  // runtime. Reading once into raw keeps the guard and both later uses on
  // the same value instead of re-reading the environment three times.
  const raw = process.env[env];
  if (!raw) {
    return;
  }
  console.log(`Using ${raw} from ${env}`);
  let node: Record<string, unknown> = obj;
  const path = dest.split('.');
  for (let i = 0; i < path.length - 1; i++) {
    if (!node[path[i]]) {
      node[path[i]] = {};
    }
    // Thus far only config objects have ever been stored under the intermediate paths.
    node = node[path[i]] as Record<string, unknown>;
  }

  let value: string | number = raw;
  if (!isNaN(Number(value))) {
    value = Number(value);
  }
  node[path[path.length - 1]] = value;
}

function readJsonSync(file: string): Configuration.Partial {
  // The JSON's shape is user-provided; it is merged and validated against the
  // schema in Config.setLayers(), so tracking it as a partial is accurate.
  return JSON.parse(StripJsonComments(FS.readFileSync(file).toString())) as Configuration.Partial;
}

function getVersion(): string {
  try {
    const version = FS.readFileSync('./version').toString().trim();
    console.log(`Version file found: ${version}`);
    return version;
  } catch {
    console.warn('Failed to load version file. Using default.');
    return 'DEVELOPMENT';
  }
}

export const VERSION_NAME = getVersion();

const DEFAULTS: Partial<Configuration.Main> = {
  port: 3523,
  // Enabled pHash generation during auto-import.
  enablePhash: false,
  enableTensorFlow: true,
  database: { provider: 'sqlite' },
  transcoder: {
    // Copy data to speedup setup.
    maxCopyEnabled: true,
    // Anything 480p or below loads quite quickly. So don't bother downscaling if the source is less.
    minQuality: 480,
    // Transcode to a small mobile quality and up to 1080p.
    // If the source is 720p it will transcode to 240p and 1080p
    cacheQualities: [240],
    streamQualities: [240, 480, 720, 1080],
    // 1.5 results in 3M for 1080p.
    bitrateMultiplier: 1.5,
    // Enables caching keyframes when they're initially accessed.
    enableCachingKeyframes: true,
    // Makes the first load of each video slower but initial import much faster.
    enablePrecachingKeyframes: false,
    // Disables caching during import of new media. Still allows using
    // the cache of existing media.
    enableVideoCaching: false,
    enableVideoPreviews: true,
    videoPreviewHeight: 120,
    videoPreviewFps: 10,
    // Should be a multiple of videoPreviewHeight
    videoPreviewMaxHeight: 6000,
  },
  user: {
    autoplayEnabled: true,
    tagColumnCount: 1,
    // It does create a messy browser history so keep it optional.
    stateEnabled: false,
    // False because likely local high-speed access.
    lowQualityOnLoadEnabled: false,
    // True because it may be over slower WiFi.
    lowQualityOnLoadEnabledForMobile: true,
    // Limit to loading 750 items on initial UI load.
    // 750 to give 50 pages.
    initialLoadLimit: 750,
    galleryImageCount: 15,

    // Quick tag panel visibility options.
    quickTagShowRating: true,
    quickTagShowArtist: true,
    quickTagShowAlbum: true,
    quickTagShowTitle: true,
    quickTagShowPeople: true,
    quickTagShowPath: true,
    quickTagShowPlaylists: true,
    quickTagShowAutoTags: true,
    useNativeSelectOnMobile: true,
    scaleToScreenWidthOnMobile: true,

    showTaskNotifications: false,
    autoClearCompletedTasks: true,
  },
};

class Config {
  private validator: Validator<Configuration.Main>;
  private merged?: Configuration.Main;
  private baseLayers?: Configuration.Partial[];

  public static init(): Config {
    const validator = Validator.load<Configuration.Main>('Configuration.Main');
    // Load the constant layers, all of these together should validate.
    // They may be overwritten at runtime though.
    const userConfig = Config.getUserLayer();
    const environment = Config.getEnvironmentLayer();
    const config = new Config(validator);
    // Order matters, userConfig over-writes default and environment over-writes userConfig.
    config.setLayers([DEFAULTS, userConfig, environment]);

    return config;
  }

  private static getEnvironmentLayer(): Configuration.Partial {
    // Filled via mapEnv() with dotted paths that only exist per variable, so it cannot be
    // built as an object literal. It is merged and validated against the schema in Config.setLayers().
    const config: Record<string, unknown> = {};
    // General config
    mapEnv('PORT', config, 'port');
    mapEnv('DATA_PATH', config, 'libraryPath');
    mapEnv('CACHE_PATH', config, 'cachePath');
    mapEnv('USERNAME', config, 'username');
    mapEnv('PASSWORD', config, 'password');
    // Database mapping
    mapEnv('DATABASE', config, 'database.provider');
    // MongoDB database configuration options.
    mapEnv('DATABASE_URI', config, 'database.uri');
    mapEnv('DATABASE_DB', config, 'database.db');
    // SQLite
    mapEnv('DATABASE_PATH', config, 'database.path');

    return config;
  }

  private static getUserLayer(): Configuration.Partial {
    const path = process.env['CONFIG_PATH'];
    if (!path) {
      // The user layer is optional.
      return {};
    }
    return readJsonSync(path);
  }

  private constructor(validator: Validator<Configuration.Main>) {
    this.validator = validator;
  }

  public get(): Configuration.Main {
    if (!this.merged) {
      throw new Error('Configuration layers incorrectly configured');
    }
    return this.merged;
  }

  public setUserOverlay(config: Configuration.Partial): void {
    this.setLayers([config]);
  }

  private setLayers(layers: Configuration.Partial[]): void {
    const layerArray: Configuration.Partial[] = [];
    if (this.baseLayers) {
      layerArray.push(...this.baseLayers);
    }
    layerArray.push(...layers);

    const merged = DeepMerge.all(layerArray, {
      arrayMerge: (_: object[], sourceArray: object[]): object[] => sourceArray,
    }) as Configuration.Main;
    // Remove duplicate items in the qualities array.
    merged.transcoder.cacheQualities = [...new Set(merged.transcoder.cacheQualities)].sort((a, b) => a - b);
    merged.transcoder.streamQualities = [...new Set(merged.transcoder.streamQualities)].sort((a, b) => a - b);

    // The merged config is validated here; validate() throws a BadRequest
    // carrying the Ajv error text when a layer breaks the schema.
    this.validator.validate(merged);

    // On the first call store the layers as the write-once base layers.
    if (!this.baseLayers) {
      // Some additional validation.
      if (PathIsInside(Path.resolve(merged.cachePath), Path.resolve(merged.libraryPath))) {
        throw new Error('Cache folder cannot be inside the library');
      }
      this.baseLayers = layers;
    }
    // Otherwise don't store the layers because they're stored in the database.
    this.merged = merged;
  }
}

export default Config.init();
