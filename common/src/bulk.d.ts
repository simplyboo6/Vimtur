import { SubsetConstraints } from './search';
import { UpdateMedia } from './media';

export interface BulkUpdate {
  constraints: SubsetConstraints;
  update: UpdateMedia;
}
