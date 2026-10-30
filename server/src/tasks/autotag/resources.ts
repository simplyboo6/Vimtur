import OS from 'os';

/**
 * Auto-tagging runs one worker per pool instance, and each worker pins its own
 * inference session: model memory (a ResNet-101 session is on the order of
 * 500MB) plus a thread pool. An instance per CPU core fits neither RAM nor the
 * scheduler, so both the pool size and each session's intra-op threads derive
 * from this one cap: intra-op threads converge to the remainder of the core
 * count, see classifier-worker.ts.
 */
export const MAX_INSTANCES = Math.min(4, OS.cpus().length);
