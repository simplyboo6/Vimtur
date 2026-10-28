# API test known issues

Behaviours discovered while writing the API stability tests. All open issues
have been fixed (see git history); what remains under "By design" is
intentional, or pinned deliberately so a refactor cannot silently change it.

## Open

(none)

## By design

1. **Subset constraints are silently overwritten.** `POST /api/images/subset`
   (and bulk-update) force `corrupted=false`, `indexed=true` and
   `duplicateOf.exists=false` after validation, so requests setting them are
   ignored. The client relies on these defaults. Pinned in `search.spec.ts`.

2. **SCAN results report pending work, not the last scan.** `SCAN/results`
   shows what is *not yet consumed* by INDEX / DELETE-MISSING; both tasks
   clear their list when they run. Documented in `import-lifecycle.spec.ts`
   as the client may depend on it.

3. **Task ids reuse `-N` suffixes.** After a task completes and is cleared,
   its suffix is free again, so `SCAN-0` can recur across the server's
   lifetime. Pinned in `tasks.spec.ts`.

4. **Deletes are idempotent no-ops.** Deleting unknown tags, actors or
   playlists, unknown media-playlist entries, and cancelling unknown queue
   entries respond 2xx without error. Pinned in `tags.spec.ts`,
   `actors.spec.ts`, `playlists.spec.ts` and `tasks.spec.ts`.
