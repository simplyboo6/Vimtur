import FS from 'fs';
import Util from 'util';

import type { Media } from '@vimtur/common';
import type Express from 'express';
import Auth from 'http-auth';
import RimRaf from 'rimraf';

import Config from '../config';

export function authConnector(req: Express.Request, res: Express.Response, next: Express.NextFunction): void {
  if (Config.get().username && Config.get().password) {
    const basicAuth = Auth.basic(
      { realm: 'Vimtur Media Manager' },
      (username: string, password: string, callback: (result: boolean) => void) => {
        callback(username === Config.get().username && password === Config.get().password);
      },
    );
    basicAuth.check(() => next())(req, res);
  } else {
    next();
  }
}

export async function deleteCache(hash: string): Promise<void> {
  const thumbnail = `${Config.get().cachePath}/thumbnails/${hash}.png`;
  try {
    await Util.promisify(FS.unlink)(thumbnail);
  } catch (errUnknown: unknown) {
    const err = asError(errUnknown);
    if (!err.message.startsWith('ENOENT')) {
      throw err;
    }
  }
  console.log(`${thumbnail} removed`);

  const preview = `${Config.get().cachePath}/previews/${hash}.png`;
  try {
    await Util.promisify(FS.unlink)(preview);
  } catch (errUnknown: unknown) {
    const err = asError(errUnknown);
    if (!err.message.startsWith('ENOENT')) {
      throw err;
    }
  }
  console.log(`${preview} removed`);

  const cache = `${Config.get().cachePath}/${hash}/`;
  try {
    await Util.promisify(RimRaf)(cache);
  } catch (errUnknown: unknown) {
    const err = asError(errUnknown);
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
  } catch (errUnknown: unknown) {
    const err = asError(errUnknown);
    if (!err.message.startsWith('ENOENT')) {
      throw err;
    }
  }
  console.log(`${media.absolutePath} removed`);
}

export function asError(obj: unknown): Error {
  if (typeof obj === 'object') {
    if (obj instanceof Error) {
      return obj;
    }
    const recordObj = obj as Record<string, unknown>;
    const message = recordObj['message'];
    if (typeof message === 'string') {
      return new Error(message);
    }
    return new Error(`Unknown error object`);
  } else if (typeof obj === 'string') {
    return new Error(obj);
  } else {
    return new Error(`Unknown error type: ${typeof obj}`);
  }
}
