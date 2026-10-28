# API test known issues

Behaviours discovered while writing the API stability tests and deliberately
**not fixed** (the tests pin current behaviour so a refactor cannot silently
change it). Each should be triaged in a dedicated bug-fix phase; when one is
fixed, update the corresponding test and remove the entry.

1. **Attaching a non-existent tag 500s.** `POST /api/images/:hash/tags` with a
   `name` that has no global tag leaks a raw FOREIGN KEY constraint error as a
   500. The client always creates tags globally first, masking this.
   (`media-mutations.spec.ts` — comment on the bulk-update tag test.)

2. **PATCH on an unknown media hash upserts a partial row.** `PATCH
   /api/images/:hash` for an unknown hash creates a record with only the
   provided fields; subsequent reads of that hash fail with 500 ("Cannot
   calculate absolutePath without path"). Pinned in
   `media-mutations.spec.ts`.

3. **bulk-update with an empty update object 500s.** The UpdateMedia schema
   accepts an empty object, but `saveBulkMedia` then throws "Nothing to
   update" as a 500 instead of rejecting with 400. Pinned in
   `media-mutations.spec.ts`.

4. **Unknown playlist reads are a plain-text 200.** `GET /api/playlists/:id`
   for an unknown id responds `OK` (text) with 200 instead of 404; `DELETE`
   is a silent 204 no-op. Pinned in `playlists.spec.ts`.

5. **Adding media to an unknown playlist 500s.** `PUT
   /api/images/:hash/playlists/:id` with an unknown playlist leaks a FOREIGN
   KEY error. Not directly pinned (the FK path is the same as issue 1).

6. **Streaming error responses carry a video/mp2t content type.** Pre-stream
   JSON errors on `data.ts` respond with `Content-Type: video/mp2t` because
   the route sets it before the failure path. Pinned in `streaming.spec.ts`.

7. **Still images are not rejected on the master playlist route.** `GET
   /api/images/:hash/stream/index.m3u8` for a still returns a playlist; the
   media playlist route then fails with a 500. Pinned in `streaming.spec.ts`.

8. **Subset constraints are silently overwritten.** `POST /api/images/subset`
   (and bulk-update) force `corrupted=false`, `indexed=true` and
   `duplicateOf.exists=false` after validation, silently ignoring requests
   that set them. Pinned in `search.spec.ts`.

9. **SQLite worker flush timer stats `:memory:`.** The 30s WAL-size flush in
   `worker.ts` calls `FS.stat(filename)`, logging an ENOENT error every 30s
   when the database is `:memory:`. Harmless; noisy in API-test logs.

10. **SCAN results report pending work, not the last scan.** `SCAN/results`
    shows what is *not yet consumed* by INDEX / DELETE-MISSING; both tasks
    clear their list when they run. Documented in `import-lifecycle.spec.ts`
    rather than fixed, as the client may depend on it.

11. **Task ids reuse `-N` suffixes.** After a task completes and is cleared,
    its suffix is free again, so `SCAN-0` can recur across the server's
    lifetime. Pinned in `tasks.spec.ts`.

12. **`GET /api/images/:hash` 500s for records without a path.** Related to
    issue 2: any media row missing `path` breaks detail reads with 500
    instead of a controlled error.
