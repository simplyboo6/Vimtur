import type { ExecutorPromise, ExecutorResults } from 'proper-job';

export type DownloaderCallback = (progressPercent: number) => void;
export type DownloaderRunner = (
  target: string,
  outputPath: string,
  callback: DownloaderCallback,
) => ExecutorPromise<ExecutorResults<void>>;

export interface Downloader {
  id: string;
  name: string;
  runner: DownloaderRunner;
}
