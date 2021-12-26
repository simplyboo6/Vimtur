// Download using yt-dlp with command
// yt-dlp --progress --quiet --add-metadata --restrict-filenames -P <data dir>/downloads/<path that includes sanitised url> <url>
import { ExecutorPromise, ExecutorResults } from 'proper-job';
import ChildProcess from 'child_process';
import type { Downloader, DownloaderCallback } from '../../types';

export function getDownloader(): Downloader {
  return {
    id: 'YT-DLP',
    name: 'youtube-dl (yt-dlp)',
    runner: (target: string, outputDir: string, updateStatus: DownloaderCallback) => {
      return new ExecutorPromise<ExecutorResults<void>>((resolve, reject) => {
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
          outputDir,
          target,
        ]);

        let aborted = false;

        proc.stdout.on('data', (data) => {
          const line = data.toString().trim();
          if (line.startsWith('[download]') && !aborted) {
            const progressString = line.split(' ').filter((seg: string) => Boolean(seg))[1];
            if (progressString.endsWith('%')) {
              updateStatus(Number(progressString.slice(0, -1)));
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
