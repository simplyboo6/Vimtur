import { BaseMedia, Configuration } from '@vimtur/common';

export interface DumpFile {
  tags: string[];
  actors: string[];
  media: BaseMedia[];
  config?: Configuration.Partial;
  version?: number;
}
