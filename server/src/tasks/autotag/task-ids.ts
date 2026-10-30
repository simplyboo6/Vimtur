import { AUTO_TAG_MODELS } from './models';

/**
 * The task registered for the registry's first (default) model, used by
 * AUTO-IMPORT. Kept in a tiny module because the importer (routes/tasks.ts)
 * must not pull the runner's transcoder and processing-job dependencies into
 * the meta-task route.
 */
export const DEFAULT_TASK_ID = `AUTO-TAG-${AUTO_TAG_MODELS[0].id}`;
