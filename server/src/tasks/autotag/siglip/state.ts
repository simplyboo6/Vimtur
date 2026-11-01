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
 */
export function deriveTagState(
  tag: string,
  configTag: Configuration.AutoTagTag | undefined,
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
  tags: Record<string, Configuration.AutoTagTag>;
}

const CALIBRATION_TASK_ID = 'CALIBRATE-SIGLIP2-B32';
const AUTO_TAG_TASK_ID = `AUTO-TAG-${AVES_SIGLIP2_B32.id}`;

export function autotagSettings(): AutotagSettings {
  const section = Config.get().autotags;
  // DEFAULTS guarantee every field; the optional type exists because stored
  // overlays from older installs do not carry the section.
  return {
    model: section?.model ?? AUTO_TAG_TASK_ID,
    workers: section?.workers ?? 5,
    minSupport: section?.minSupport ?? 8,
    calibrationSampleSize: section?.calibrationSampleSize ?? 500,
    tags: section?.tags ?? {},
  };
}

/** Read helper for the calibration task's persisted last run. */
export async function loadCalibrationRun(database: Database): Promise<Autotag.CalibrationRun | undefined> {
  return (await database.getTaskState(CALIBRATION_TASK_ID, 'last-run')) as Autotag.CalibrationRun | undefined;
}

/** Write helper used by the calibration task itself. */
export async function saveCalibrationRun(database: Database, run: Autotag.CalibrationRun): Promise<void> {
  await database.setTaskState(CALIBRATION_TASK_ID, 'last-run', run);
}

/**
 * How many stored tags AUTO-TAG would really score right now. AUTO-IMPORT uses
 * this to skip a zero-shot run that its own fail-fast would turn into an
 * errored task: the dead-tag rule scores stored tags only (config-only entries
 * are ignored) and deriveTagState remains the single precedence rule, so this
 * count cannot drift from the task's own decision.
 */
export async function countApplicableTags(database: Database, settings: AutotagSettings): Promise<number> {
  const dbTags = await database.getTags();
  const storedRun = await loadCalibrationRun(database);
  // Thresholds computed in another pack's embedding space are meaningless, so
  // a mismatched run is ignored exactly as the AUTO-TAG task ignores it.
  const run = storedRun && storedRun.modelId === AVES_SIGLIP2_B32.id ? storedRun : undefined;
  let count = 0;
  for (const tag of dbTags) {
    if (deriveTagState(tag, settings.tags[tag], run, settings.minSupport).threshold !== undefined) {
      count++;
    }
  }
  return count;
}

export { AUTO_TAG_TASK_ID, CALIBRATION_TASK_ID };
