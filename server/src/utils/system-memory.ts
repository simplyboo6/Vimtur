import OS from 'node:os';

/**
 * Conservative per-worker memory allowance for the zero-shot auto-tagging
 * encoder pool, in bytes.
 *
 * Measured on 2026-11-01 with a throwaway probe (not committed) that loaded the
 * compiled SiglipEncoderPool against the cached AVES-SIGLIP2-B32 pack and
 * embedded one still plus 32 prompts per instance, in a fresh process per
 * instance count: ~1.14GB RSS at 1 instance, ~1.48GB at 4, ~2.47GB at 6 and
 * ~3.1-3.4GB at 8, over an ~90MB import baseline. The marginal cost of one
 * more worker therefore measures between ~114MB (1 -> 4, where the shared
 * model pages still dominate) and ~478MB (4 -> 8, where the per-instance
 * activation arenas dominate): the model files are mapped once for all worker
 * threads, the arenas are not. 400MB sits inside that measured range, chosen
 * deliberately high of the shared-pages-dominated low end so the 50% cap errs
 * towards fewer workers rather than breaking the budget. The fixed ~1GB the
 * first worker adds (shared model mappings plus the parent's tokenizer) is not
 * modelled.
 */
const AUTOTAG_WORKER_MEMORY_BYTES = 400 * 1024 * 1024;

// Encoder workers may claim at most half of system memory.
const AUTOTAG_WORKER_MEMORY_SHARE = 0.5;

// Upper bound of autotags.workers in common/src/config.d.ts; duplicated as a
// number here because common is declaration-only (no runtime exports).
const MAX_AUTOTAG_WORKERS = 8;

/**
 * RAM-derived ceiling on auto-tagging workers: no more than half of system
 * memory divided by the measured per-worker allowance, within the schema's
 * 1..8. Used as the boot default written into the config DEFAULTS and by
 * encoderInstances(), which clamps an explicit user value against the same
 * rule.
 *
 * os.totalmem() reports host RAM, so a memory-capped container (the Docker
 * image is a supported install) can exceed the budget this computes from.
 */
export function autotagWorkerMemoryLimit(): number {
  const byMemory = Math.floor((OS.totalmem() * AUTOTAG_WORKER_MEMORY_SHARE) / AUTOTAG_WORKER_MEMORY_BYTES);
  return Math.max(1, Math.min(MAX_AUTOTAG_WORKERS, byMemory));
}
