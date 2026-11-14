import Config from '../../config';

import { CAPTION_PACKS } from './pack';

/** Page settings with the config overlay's own defaults guaranteed. */
export interface AutocaptionSettings {
  /** An AUTO-CAPTION task id; see Configuration.AutoCaption.model. */
  model: string;
  workers: number;
  maxTokens: number;
}

/**
 * Page settings, with every field required: Config DEFAULTS are merged at load
 * and therefore provide all of them, so this throws rather than filling gaps.
 * The optionality in Configuration.Main only reflects what a stored overlay may
 * carry on its own (the merged config is always complete).
 */
export function autocaptionSettings(): AutocaptionSettings {
  const section = Config.get().autocaption;
  // A missing section means the merged config was corrupted: a loud failure
  // beats silently inventing a worker or token count, which would mask the
  // corruption and make the Auto-Captioning page show settings that are not
  // actually in effect.
  if (!section) {
    throw new Error('Merged config is missing the autocaption section; DEFAULTS should have provided it');
  }
  return { model: section.model, workers: section.workers, maxTokens: section.maxTokens };
}

/** What AUTO-IMPORT should do about auto-captioning, and why. */
export type CaptionTaskSelection = { action: 'start'; taskId: string } | { action: 'unknown-model' };

/**
 * The auto-captioning task AUTO-IMPORT should start for the configured model,
 * or why it should not. The model is the configured AUTO-CAPTION task id
 * because the roster is the server's own task list, so the config cannot
 * enumerate it; membership is therefore checked here rather than by the config
 * schema. Unknown values are a distinct outcome rather than a silent skip so
 * the import can warn about a stale hand-edited config value. Pure so the
 * routing can be unit-tested without a server.
 */
export function pickCaptionTask(model: string): CaptionTaskSelection {
  // The registry in pack.ts owns the ids the per-pack tasks would use, so the
  // registered-task check in the import gate covers a build where a pack has no
  // task.
  const known = CAPTION_PACKS.some((pack) => model === `AUTO-CAPTION-${pack.id}`);
  return known ? { action: 'start', taskId: model } : { action: 'unknown-model' };
}
