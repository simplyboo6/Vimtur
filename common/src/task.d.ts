export interface QueuedTask {
  id: string;
  type: string;
  description: string;
  running: boolean;
  aborted: boolean;
  current: number;
  max: number;
  error?: string;
  complete: boolean;
}

export interface ListedTask {
  id: string;
  description: string;
}
