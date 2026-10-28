# API test known issues

Behaviours discovered while writing the API stability tests. "Open" items are
genuine bugs to fix in the bug-fix phase; each lists the test pinning the
current behaviour so a refactor cannot silently change it. Items under
"By design" are intentional (or pinned deliberately) and have no fix planned.
When an open item is fixed, its entry is removed.

## Open

1. **Attaching a non-existent tag or actor 500s.** `POST /api/images/:hash/tags`
   and `/actors` with a `name` that has no global tag/actor leak a raw FOREIGN
   KEY constraint error as a 500. The client always creates them globally
   first, masking this. (The pinning comment lives in `media-mutations.spec.ts`
   on the bulk-update tag test.)

2. **bulk-update with an empty update object 500s.** The UpdateMedia schema
   accepts an empty object, but `saveBulkMedia` then throws "Nothing to
   update" as a 500 instead of rejecting with 400. Pinned in
   `media-mutations.spec.ts`.

3. **Unknown playlist reads are a plain-text 200.** `GET /api/playlists/:id`
   for an unknown id responds `OK` (text) with 200 instead of 404. Pinned in
   `playlists.spec.ts`.

4. **Adding media to an unknown playlist 500s.** `PUT
   /api/images/:hash/playlists/:id` with an unknown playlist leaks a FOREIGN
   KEY error. (The FK path is the same as issue 1.)

5. **Streaming error responses carry a video/mp2t content type.** Pre-stream
   JSON errors on `data.ts` respond with `Content-Type: video/mp2t` because
   the route sets it before the failure path. Pinned in `streaming.spec.ts`.

6. **Still images are not rejected on the master playlist route.** `GET
   /api/images/:hash/stream/index.m3u8` for a still returns a playlist; the
   media playlist route then fails with a 500. Pinned in `streaming.spec.ts`.

7. **SQLite worker flush timer stats `:memory:`.** The 30s WAL-size flush in
   `worker.ts` calls `FS.stat(filename)`, logging an ENOENT error every 30s
   when the database is `:memory:`. Harmless; noisy in API-test logs.

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
