import Path from 'path';
import { TaskArgs } from '@vimtur/common';
import { ImportUtils } from '../cache/import-utils';
import Config from '../config';
import type { Task, TaskRunnerCallback } from '../types';
import { getDownloaders } from './downloaders';

const downloaders = getDownloaders();

export function getTask(): Task {
  return {
    id: 'DOWNLOAD',
    description: 'Download Files',
    args: [
      {
        type: 'select',
        name: 'Downloader',
        values: downloaders.map((downloader) => ({ id: downloader.id, name: downloader.name })),
        required: true,
      },
      { type: 'string', name: 'URL', required: true },
    ],
    init: () => {
      const downloadPath = Path.resolve(Config.get().libraryPath, 'vimtur-downloads');
      return ImportUtils.mkdir(downloadPath);
    },
    runner: (updateStatus: TaskRunnerCallback, args?: TaskArgs) => {
      if (!args) {
        throw new Error('args not found');
      }
      const [downloaderId, target] = args;
      if (!downloaderId) {
        throw new Error('downloaderId not set');
      }
      if (!target) {
        throw new Error('target not set');
      }

      const downloader = downloaders.find((el) => el.id === downloaderId);
      if (!downloader) {
        throw new Error('downloader not found with matching ID');
      }

      const downloadPath = Path.resolve(Config.get().libraryPath, 'vimtur-downloads');
      const downloadText = `${downloader.name}: ${target}`;
      updateStatus(0, 0, downloadText);

      return downloader.runner(target, downloadPath, (current, max) => {
        updateStatus(current, max, downloadText);
      });
    },
  };
}
