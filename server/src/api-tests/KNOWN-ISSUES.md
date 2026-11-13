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

2. **SCAN state reports pending work, not the last scan's diff.** The SCAN
   task persists its pending work in the task_state store as three keys under
   `SCAN` (the definition id, never a queue instance id like `SCAN-0`):
   `new-paths` and `missing-paths` (path arrays) and `generated-at` (epoch ms).
   The scan-specific `/api/tasks/SCAN/results*` routes no longer exist; the UI
   and these tests read the keys through the generic
   `GET /api/tasks/state/:taskId/:key` endpoint, and any of the three keys
   being absent reads as "no scan". The lists show what is *not yet consumed*
   by INDEX / DELETE-MISSING: INDEX clears `new-paths` when it runs, and
   DELETE-MISSING clears `missing-paths` once deletion actually starts — but a
   DELETE-MISSING run refused by the safety limit keeps the list so it can be
   retried without a new SCAN. Each consumer rewrites only its own key;
   `generated-at` is deliberately retained across consumption for the UI's
   "last scan" display (the config page's Scan Results section). A SCAN that
   fails (e.g. the library volume is unavailable) leaves the previous scan's
   state untouched — except a write failure part-way through the three
   non-transactional upserts, which can leave a list newer than `generated-at`
   (see the commit-marker note below). The keys are persisted (not process
   memory), so the hand-off survives a server restart — but persistence is not
   resumability: aborting or partially completing INDEX / DELETE-MISSING still
   consumes that run's list (the finalize clear runs whether or not the task
   errored), so recovery is a fresh SCAN. A successful scan's three writes are
   individually atomic but not transactional: `generated-at` is written last as
   the commit marker, and only the UI's freshness display reads it — each
   consumer re-derives its work from its own key. Documented in
   `import-lifecycle.spec.ts` and `scan-restart.spec.ts`, and pinned in
   `delete-missing-safety.spec.ts`.

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

8. **Calibration purges persisted overlay entries for deleted tags.** At
   calibration, `autotags.tags` entries in the persisted config overlay whose
   tag is absent from the tag store are **deleted** — a config.json- or
   env-sourced entry that is still resolvable is warned about instead, never
   deleted, because only the overlay is in the purge's reach. The config write
   goes through the same validate/rename/persist path as `POST /api/config`,
   so a purge cannot persist a shape the config API would reject. Pinned in
   `smart-search.spec.ts`.

9. **Auto-tagging scores configured DB tags only (the configured-tag rule).**
   A tag is scored, tagged and calibrated only when it exists in the tag store
   *and* has an `autotags.tags` entry (a description or a manual threshold opts
   it in); a DB tag with no entry is inert. A manual threshold on a config-only
   tag that does not exist in the tag store is therefore never applied, so it
   cannot satisfy the "No tags have an applicable threshold" fail-fast either:
   the task still fails until a configured DB tag has a usable threshold.
   `applicableTags` mirrors threshold precedence rather than this rule, so the
   task drops config-only tags itself. The dead-tag purge still removes config
   entries whose tag was deleted (item 8). Pinned by the zeta test in
   `smart-search.spec.ts`.

10. **Deleting media keeps the source file unless `deleteFile=true` is asked
    for.** `DELETE /api/images/:hash` always records the media's path in the
    import ignore list (that entry is what stops the next SCAN re-importing a
    kept file) and always drops its cache, but only unlinks the file when the
    query parameter is a literal `true`. Anything other than `true`/`false`/
    absent — including a repeated parameter — is a 400. `DELETE-MISSING` keeps
    unlinking because those files are already gone. Pinned in
    `deleted-paths.spec.ts` and `import-lifecycle.spec.ts`.

11. **The ignore list is keyed by content hash and records paths.** Rows are
    `{hash, path}` pairs; the same hash deleted (or found again) at a second
    path adds a row (SQLite's `(hash, path)` primary key, MongoDB's matching
    composite index) rather than replacing the first. SCAN matches recorded
    paths and INDEX matches recorded hashes, adding the path it saw, so one
    `media_deleted` row per hash would not be enough. `GET /api/deleted`
    returns every row, sorted by hash then path, unpaged; `DELETE
    /api/deleted/:hash` removes every path for that hash (and is an idempotent
    no-op for an unknown one), because the ignore checks are hash-based and a
    surviving row would keep the content ignored. Pinned in
    `deleted-paths.spec.ts`, `test/database.ts` and `test/mongodb.ts`.

Things that used to live here as one-off deltas from the error-handler and
plain-`res.json()` migration are documented as standing conventions in the
repo `AGENTS.md` ("API response and error conventions") instead.
