// Download using yt-dlp with command
// yt-dlp --progress --quiet --add-metadata --restrict-filenames -P <data dir>/downloads/<path that includes sanitised url> <url>
import ChildProcess from 'child_process';
import Path from 'path';
import { URL } from 'url';
import { ExecutorPromise, ExecutorResults } from 'proper-job';
import type { Downloader, DownloaderCallback } from '../../types';

export function getDownloader(): Downloader {
  return {
    id: 'YT-DLP',
    name: 'youtube-dl (yt-dlp)',
    runner: (target: string, outputDir: string, updateStatus: DownloaderCallback) => {
      return new ExecutorPromise<ExecutorResults<void>>((resolve, reject) => {
        const url = new URL(target);
        const hostname = url.hostname;
        const proc = ChildProcess.spawn('yt-dlp', [
          '--progress',
          '--newline',
          '--quiet',
          '--add-metadata',
          '--restrict-filenames',
          '-S',
          // Prefer h264.
          // TODO In future revisit this to support vp9, vp8 in UI and backend.
          '+codec:h264',
          '-P',
          // yt-dlp will create the sub-direcotry if it does not exist.
          Path.resolve(outputDir, 'yt-dlp', hostname),
          target,
        ]);

        let aborted = false;
        let fileCount = 0;
        let lastPercent = 0;

        proc.stdout.on('data', (data) => {
          const line = data.toString().trim();
          if (line.startsWith('[download]') && !aborted) {
            const progressString = line.split(' ').filter((seg: string) => Boolean(seg))[1];
            if (progressString.endsWith('%')) {
              const currentPercent = Number(progressString.slice(0, -1));
              if (currentPercent < lastPercent) {
                fileCount++;
              }
              lastPercent = currentPercent;
              updateStatus(fileCount * 100 + currentPercent, (fileCount + 1) * 100);
            }
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
