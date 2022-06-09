import { UpdateMedia } from "./media";
import { SubsetConstraints } from "./search";

export interface BulkUpdate {
  constraints: SubsetConstraints;
  update: UpdateMedia;
}
