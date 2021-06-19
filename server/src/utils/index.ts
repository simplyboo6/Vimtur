import FS from 'fs';
import Util from 'util';

import Auth from 'http-auth';
import RimRaf from 'rimraf';
import type Express from 'express';

import Config from '../config';
import type { Media } from '@vimtur/common';

export function authConnector(
  req: Express.Request,
  res: Express.Response,
  next: Express.NextFunction,
): void {
  if (Config.get().username && Config.get().password) {
    const basicAuth = Auth.basic(
      { realm: 'Vimtur Media Manager' },
      (username: string, password: string, callback: (result: boolean) => void) => {
        callback(username === Config.get().username && password === Config.get().password);
      },
    );
    return Auth.connect(basicAuth)(req, res, next);
  }
  next();
}

export async function deleteCache(hash: string): Promise<void> {
  const thumbnail = `${Config.get().cachePath}/thumbnails/${hash}.png`;
  try {
    await Util.promisify(FS.unlink)(thumbnail);
  } catch (err) {
    if (!err.message.startsWith('ENOENT')) {
      throw err;
    }
  }
  console.log(`${thumbnail} removed`);

  const preview = `${Config.get().cachePath}/previews/${hash}.png`;
  try {
    await Util.promisify(FS.unlink)(preview);
  } catch (err) {
    if (!err.message.startsWith('ENOENT')) {
      throw err;
    }
  }
  console.log(`${preview} removed`);

  const cache = `${Config.get().cachePath}/${hash}/`;
  try {
    await Util.promisify(RimRaf)(cache);
  } catch (err) {
    if (!err.message.startsWith('ENOENT')) {
      throw err;
    }
  }
  console.log(`${cache} removed`);
}

export async function deleteMedia(media: Media): Promise<void> {
  await deleteCache(media.hash);

  try {
    await Util.promisify(FS.unlink)(media.absolutePath);
  } catch (err) {
    if (!err.message.startsWith('ENOENT')) {
      throw err;
    }
  }
  console.log(`${media.absolutePath} removed`);
}
