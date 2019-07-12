import { BaseMedia } from './media';
import { Configuration } from './config';

export interface DumpFile {
  tags: string[];
  actors: string[];
  media: BaseMedia[];
  config?: Configuration.Partial;
  version?: number;
}
