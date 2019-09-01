import * as Express from 'express';
import Auth from 'http-auth';
import FS from 'fs';
import RimRaf from 'rimraf';
import Util from 'util';

import { Media } from '../types';
import Config from '../config';

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

export async function deleteMedia(media: Media): Promise<void> {
  const hash = media.hash;
  await Util.promisify(FS.unlink)(media.absolutePath);
  console.log(`${media.absolutePath} removed`);

  const thumbnail = `${Config.get().cachePath}/thumbnails/${hash}.png`;
  await Util.promisify(FS.unlink)(thumbnail);
  console.log(`${thumbnail} removed`);

  const cache = `${Config.get().cachePath}/${hash}/`;
  await Util.promisify(RimRaf)(cache);
  console.log(`${cache} removed`);
}
