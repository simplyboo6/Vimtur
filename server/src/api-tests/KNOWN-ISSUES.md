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
   shows what is *not yet consumed* by INDEX / DELETE-MISSING. INDEX always
   clears the new-files list when it runs, and DELETE-MISSING clears the
   missing list once deletion actually starts — but a DELETE-MISSING run
   refused by the safety limit keeps the list so it can be retried without a
   new SCAN. A SCAN that fails (e.g. the library volume is unavailable)
   leaves the previous scan's results untouched. Documented in
   `import-lifecycle.spec.ts` and pinned in `delete-missing-safety.spec.ts`.

3. **DELETE-MISSING refuses to delete more than 10% of the database in its
   default (strict) safety mode**, and requires the explicit `allow-all`
   argument to override. POST bodies for tasks that define arguments must be
   arrays (e.g. `['allow-all']` or `[]`); `{}` is normalised to "no
   arguments". Pinned in `delete-missing-safety.spec.ts`; see issue #129.

4. **SCAN deliberately fails on unreadable or absent library paths.** If
   `libraryPath` cannot be read, is not a directory, or has directories the
   walk cannot open, the scan fails instead of proceeding, because files
   unknown to the scan would be reported (and are deletable) as missing.
   There is no override: a deliberately emptied library cannot have its
   entries cleared through SCAN → DELETE-MISSING and must be removed one by
   one through the media API. Also note the server never creates
   `DATA_PATH`/`libraryPath` itself, so a fresh install with a missing
   directory now fails its first AUTO-IMPORT until it is created. See issue
   #129.

5. **Task ids reuse `-N` suffixes.** After a task completes and is cleared,
   its suffix is free again, so `SCAN-0` can recur across the server's
   lifetime. Pinned in `tasks.spec.ts`.

6. **Deletes are idempotent no-ops.** Deleting unknown tags, actors or
   playlists, unknown media-playlist entries, and cancelling unknown queue
   entries respond 2xx without error. Pinned in `tags.spec.ts`,
   `actors.spec.ts`, `playlists.spec.ts` and `tasks.spec.ts`.

7. **Attaching a tag or actor requires the global record to exist.** The
   attachment endpoints 404 ("No tag/actor found with name: X") rather than
   creating an implicit empty record, because global tags and actors carry
   more data than their name. The client chains create → attach (see
   `TagService.addTag` / `MediaService.addTagRaw`). Pinned in `tags.spec.ts`
   and `actors.spec.ts`.

8. **Cache path rejections drop the `type: 'config'` field.** Cache file
   paths escaping the cache directory respond 400 `{message}` from the same
   central error handler as the `/api` routes; the historical extras field
   never had a consumer. Pinned in `errors.spec.ts`.

9. **All error bodies are JSON `{message}`, including pre-route failures.**
   Unparseable JSON request bodies (body-parser) respond 400 with a JSON
   `{message}` body instead of the blank/HTML default Express error page, and
   any error arriving with a status already attached keeps it. Pinned in
   `errors.spec.ts` and `src/test/error-handler.ts`.
