import type { Autotag, Configuration } from '@vimtur/common';

import Config from '../../../config';
import type { Database } from '../../../types';

import { AVES_SIGLIP2_B32 } from './pack';

/**
 * Calibrated-run state lives ONLY in the generic task-state store (key
 * `last-run` under the calibration task's definition id); the config
 * overlay keeps manual thresholds and descriptions. This module is the one
 * place that derives a tag's status and emission decision from those two
 * sources. Editing a tag's descriptions changes its prompt set and therefore
 * invalidates the stored thresholds until the next calibration run: the run's
 * perTag is a snapshot, and emission is recomputed from the current floor by
 * deriveTagState.
 */

export interface TagState {
  /** Wire status string; see Autotag.TagStatus. */
  status: Autotag.TagStatus;
  /**
   * Threshold the auto-tagging run applies, or undefined when the tag can
   * never be auto-applied. Manual overrides and calibrated `0` are real
   * values; the review and uncalibrated states never emit.
   */
  threshold?: number;
}

/**
 * Decision rules, in precedence order (mirrors the Auto-Tagging page):
 * 1. A manual threshold (including the meaningful zero) is applied as-is —
 *    an explicit user decision wins over any calibration.
 * 2. A calibrated threshold with support >= the configured floor is applied.
 * 3. A calibrated threshold below the floor is recorded but inert (Review).
 * 4. Everything else is Not calibrated.
 *
 * The client-side mirror in the Auto-Tagging page is a consciously-kept
 * duplication: common/src is declaration-only, so there is no runtime code the
 * two could share. The server precedence is pinned by the unit tests here and
 * the api-test helper applicableTags; the client mirror is kept in step by
 * review.
 */
export function deriveTagState(
  tag: string,
  configTag: Configuration.AutoTagMetadata | undefined,
  run: Autotag.CalibrationRun | undefined,
  minSupport: number,
): TagState {
  const manual = configTag?.manualThreshold;
  if (typeof manual === 'number') {
    return { status: 'Manually overridden', threshold: manual };
  }
  const calibrated = run?.perTag[tag];
  if (calibrated && typeof calibrated.threshold === 'number') {
    if (calibrated.support >= minSupport) {
      return { status: 'Calibrated', threshold: calibrated.threshold };
    }
    // Below the floor: keep the calibration visible but never emitted.
    return { status: 'Review (low support)' };
  }
  return { status: 'Not calibrated' };
}

/** Page settings with the config overlay's own defaults guaranteed. */
export interface AutotagSettings {
  /** An AUTO-TAG task id; see Configuration.AutoTags.model. */
  model: string;
  workers: number;
  minSupport: number;
  calibrationSampleSize: number;
  tags: Record<string, Configuration.AutoTagMetadata>;
}

/**
 * The tags AUTO-TAG acts on: a DB tag is scored, tagged and calibrated only
 * when the config overlay has an entry for it under autotags.tags, because
 * that entry is the user's opt-in for the tag. The prompts themselves stay
 * unchanged (bare name, "a photo of", then the descriptions); an entry with no
 * descriptions still qualifies, so presence — not content — is the gate.
 * Config entries whose DB tag is gone are excluded as well: the next
 * calibration purges them, but until then a stale entry must not be scored.
 * Sorted because sqlite's getTags is unordered and prompt-table positions must
 * be stable across runs.
 */
export function configuredTags(dbTags: readonly string[], settings: AutotagSettings): string[] {
  return dbTags.filter((tag) => settings.tags[tag] !== undefined).sort();
}

const CALIBRATION_TASK_ID = 'CALIBRATE-SIGLIP2-B32';
const AUTO_TAG_TASK_ID = `AUTO-TAG-${AVES_SIGLIP2_B32.id}`;

/**
 * Page settings, with every field required: Config DEFAULTS are merged at load
 * and therefore provide all of them, so this throws rather than filling gaps.
 * The optionality in Configuration.AutoTags only reflects what a stored overlay
 * may carry on its own (the merged config is always complete).
 */
export function autotagSettings(): AutotagSettings {
  const section = Config.get().autotags;
  // A missing section means the merged config was corrupted: a loud failure
  // beats silently inventing a worker count or a support floor, which would
  // mask the corruption and make the Auto-Tagging page show settings that are
  // not actually in effect.
  if (!section) {
    throw new Error('Merged config is missing the autotags section; DEFAULTS should have provided it');
  }
  return {
    model: section.model,
    workers: section.workers,
    minSupport: section.minSupport,
    calibrationSampleSize: section.calibrationSampleSize,
    tags: section.tags ?? {},
  };
}

/** Read helper for the calibration task's persisted last run. */
export async function loadCalibrationRun(database: Database): Promise<Autotag.CalibrationRun | undefined> {
  return database.getTaskState<Autotag.CalibrationRun>(CALIBRATION_TASK_ID, 'last-run');
}

/** Write helper used by the calibration task itself. */
export async function saveCalibrationRun(database: Database, run: Autotag.CalibrationRun): Promise<void> {
  await database.setTaskState(CALIBRATION_TASK_ID, 'last-run', run);
}

/**
 * How many configured tags AUTO-TAG would really score right now. AUTO-IMPORT
 * uses this to skip a zero-shot run that its own fail-fast would turn into an
 * errored task: it walks the same configured∩DB roster the task scores
 * (configuredTags) and deriveTagState remains the single precedence rule, so
 * this count cannot drift from the task's own decision.
 */
export async function countApplicableTags(database: Database, settings: AutotagSettings): Promise<number> {
  const dbTags = await database.getTags();
  const storedRun = await loadCalibrationRun(database);
  // Thresholds computed in another pack's embedding space are meaningless, so
  // a mismatched run is ignored exactly as the AUTO-TAG task ignores it.
  const run = storedRun && storedRun.modelId === AVES_SIGLIP2_B32.id ? storedRun : undefined;
  let count = 0;
  for (const tag of configuredTags(dbTags, settings)) {
    if (deriveTagState(tag, settings.tags[tag], run, settings.minSupport).threshold !== undefined) {
      count++;
    }
  }
  return count;
}

export { AUTO_TAG_TASK_ID, CALIBRATION_TASK_ID };
