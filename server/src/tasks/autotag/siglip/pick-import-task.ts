// Import-time auto-tagging routing. Pure so it is unit-tested without booting
// a server, and kept beside its autotag siblings so the model-to-task check
// sits next to the ids it names. It is a known single-production-caller module
// (routes/tasks.ts is its only non-test consumer, though the unit tests import
// it too); that is accepted here because the co-location is what stops the ids
// drifting, and purity is what makes the routing testable.

import { AUTO_TAG_MODELS } from '../mobilenet/models';

import { AUTO_TAG_TASK_ID } from './state';

// The configured model is an AUTO-TAG task id. Classifier ids are
// AUTO-TAG-<registry id>, and the registry ids are themselves hyphenated
// (MOBILE-NET-V2), so only the prefix is stripped here; AUTO_TAG_MODELS
// (../mobilenet/models.ts) is the authoritative membership check.
const AUTO_TAG_TASK_ID_PATTERN = /^AUTO-TAG-(.+)$/;

/** What AUTO-IMPORT should do about auto-tagging, and why. */
export type ImportTaskSelection =
  | { action: 'start'; taskId: string }
  | { action: 'skip-siglip' }
  | { action: 'unknown-model' };

/**
 * The auto-tagging task AUTO-IMPORT should start for the configured model, or
 * why it should skip. The model is the configured AUTO-TAG task id because the
 * roster is the server's own task list, so the config cannot enumerate it;
 * membership is therefore checked here rather than by the config schema.
 * Unknown values are a distinct outcome rather than a silent skip so the import
 * can warn about a stale hand-edited config value. Pure so the routing can be
 * unit-tested without a server.
 */
export function pickImportTask(model: string, hasApplicableTags: boolean): ImportTaskSelection {
  if (model === AUTO_TAG_TASK_ID) {
    // The zero-shot task fail-fasts when no tag carries a threshold, which
    // would turn every import into an errored task on an uncalibrated server:
    // skipping it is the honest no-op.
    return hasApplicableTags ? { action: 'start', taskId: AUTO_TAG_TASK_ID } : { action: 'skip-siglip' };
  }
  const registryId = AUTO_TAG_TASK_ID_PATTERN.exec(model)?.[1];
  if (registryId !== undefined && AUTO_TAG_MODELS.some((definition) => definition.id === registryId)) {
    return { action: 'start', taskId: model };
  }
  return { action: 'unknown-model' };
}
