export interface QueuedTask {
  id: string;
  type: string;
  description: string;
  running: boolean;
  current: number;
  max: number;
  error?: string;
}

export interface ListedTask {
  id: string;
  description: string;
}
