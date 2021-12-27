import { ExecutorPromise, ExecutorResults } from 'proper-job';
import ChildProcess from 'child_process';
import type { Downloader, DownloaderCallback } from '../../types';

export function getDownloader(): Downloader {
  return {
    id: 'GALLERY_DL',
    name: 'gallery-dl',
    runner: (target: string, outputDir: string, updateStatus: DownloaderCallback) => {
      return new ExecutorPromise<ExecutorResults<void>>((resolve, reject) => {
        const proc = ChildProcess.spawn('gallery-dl', [
          '--write-metadata',
          '--dest',
          outputDir,
          target,
        ]);

        let aborted = false;
        let fileCount = 0;

        proc.stdout.on('data', (data) => {
          const line = data.toString().trim();
          if (!line.startsWith('[') && !aborted) {
            fileCount++;
            updateStatus(fileCount, 0);
          }
        });

        let err = '';
        proc.stderr.on('data', (data) => {
          err += data;
        });

        proc.on('exit', (code) => {
          if (aborted || code === 0) {
            resolve({
              results: [],
              errors: [],
              fulfilled: aborted ? 0 : 1,
              aborted,
            });
          } else {
            reject(new Error(err || `Unknown error: ${code}`));
          }
        });

        return () => {
          aborted = true;
          // Graceful exit.
          proc.kill('SIGTERM');
        };
      });
    },
  };
}
