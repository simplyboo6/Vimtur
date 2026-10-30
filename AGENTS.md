# AGENTS.md

## Repo structure

- Three-package TypeScript project: `common/` (shared types, `@vimtur/common`), `server/` (Node/Express + Socket.io backend on Node 24), `client/` (Angular 22 frontend). Uses Yarn 4 (`corepack enable`); each package has its own `yarn.lock`.
- `common/src` contains only `.d.ts` declaration files (media, search, config, playlist, etc). Both server and client depend on it via `yarn link --relative ../common` from their own directory. If imports from `@vimtur/common` fail, re-run that link after `yarn` install. (The dependency is declared as a plain `file:../common` locator in `package.json`, so a fresh `yarn` usually materialises it without the link.)
- Server entrypoint: `server/src/index.ts`; runs from `dist/`. Client build output goes to `client/dist/`, which the server serves.

## Dev flow

1. `corepack enable` once per environment. Yarn is invoked per package directory — each package has its own `.yarnrc.yml` and lockfile; run all commands inside the package you are working on.
2. Build order matters: `common` → `server` and/or `client`. After changing `common`, rebuild it and re-run `yarn link --relative ../common` in `server/` and `client/` before rebuilding those.
3. Backend run: set env (`./env-sqlite.sh` or env vars below), run `node server/dist/index.js`. Frontend: use `yarn serve` (proxies `/api`), or open `http://<host>:<port>/web/` against the server which serves `client/dist` (remember `yarn build:prod` first, see dev/prod note below).
4. Full backend regression gate: `./run-tests.sh` after every dependency/infra change (starts a disposable MongoDB container, runs the mocha suite against `dist/test`); single-file variant as documented in the Commands section.
5. Verify schema stability with toolchain changes: `rm -rf server/.schema-build-info && yarn build` in `server/`, then diff `dist/schemas` against the previous output — the generated JSON must be byte-identical when the underlying types didn't change.

## Commands (run inside the relevant package directory)

- Build server: `yarn build` in `server/` — runs `tsc`, then `create-schemas.sh` (generates JSON schemas from the `.d.ts` types in `common` into `dist/schemas`, hash-cached in `.schema-build-info`), then `copy.sh` (copies SQLite migrations to `dist/`). Deleting `dist/` alone is not enough — schema/migration files come from these scripts.
- Server tests: from repo root run `./run-tests.sh` — it starts a disposable Mongo container on port 27020, sets `DATABASE`/`DATA_PATH`/`CACHE_PATH`/`SCHEMA_PATH` env vars, and runs `yarn test` (mocha against compiled `dist/test`). Server must be built first. Docker is required.
- API stability tests: from repo root run `./run-api-tests.sh` (or `yarn build && yarn test:api` in `server/`) — boots the compiled server as a subprocess against in-memory (and one file-backed) SQLite and exercises it purely over HTTP. No Docker/Mongo. Tests live in `server/src/api-tests/`; they must stay black-box (HTTP only, types from `@vimtur/common`) and pin intentional behaviours listed in `server/src/api-tests/KNOWN-ISSUES.md`.
- Run a single server test: `cd server && TEST_MODE=1 mocha --timeout 30000 dist/test/database.ts` requires building first; tests compile only via `tsc`. A single test file doesn't need the Mongo container, but any test importing `config.ts` (directly or transitively, e.g. `cache/import-utils.ts`) fails at import time unless `DATA_PATH`/`CACHE_PATH`/`SCHEMA_PATH` are set, because the Config module validates its layers on import. Use: `TEST_MODE=1 DATABASE=sqlite DATA_PATH=/tmp/data CACHE_PATH=/tmp/cache SCHEMA_PATH=./dist/schemas npx mocha dist/test/<file>.js`.
- Lint/format: `yarn lint` / `yarn fix` in each package (server: eslint; client: `ng lint` + prettier; common: eslint).
- Client dev server: `yarn serve` in `client/` (port 8455, proxies to backend via `proxy-config.json`).

## Running locally

- Native run uses env vars (see `env-sqlite.sh`): `PORT`, `DATABASE` (`sqlite` default | `mongodb`), `DATABASE_URI`/`DATABASE_DB` for mongo, plus `DATA_PATH` (media library) and `CACHE_PATH` (must be outside `DATA_PATH`). These override `config.json` (format: `Configuration.Main` in `common/src/config.d.ts`; example in `server/config.json.example`).
- Requires system binaries outside Docker: `ffmpeg`, ImageMagick (`convert`/`identify` — the `gm` node module is configured with `imageMagick: true`), and optionally `pngquant`, `gallery-dl`, `yt-dlp`.
- `onnxruntime-node` ships prebuilt binaries (no compile toolchain); export `ONNXRUNTIME_NODE_INSTALL=skip` before `yarn install` (Yarn cannot read the npm-config route) to bypass the CUDA provider download (~271MB dead weight without a GPU). First model use needs internet access (models come from the ONNX Model Zoo mirror); afterwards they're cached under `CACHE_PATH/autotag`.

## API response and error conventions (from #152 / #138)

- Handlers answer with plain Express: `res.status(200).json(data)` for data responses, `201` only when something was created AND a body is returned (`POST /api/playlists`, `POST /api/tags` / `actors` return the full list, the task queue returns its task id under 202), and `res.sendStatus(204)` whenever the response has no body — even when a mutation created something (`POST /api/images/:hash/(tags|actors)` attachments create a link but return nothing). There is no response helper: `sendResponse` (the old Accept-header negotiation plus Buffer→base64 reviver) was removed as dead code.
- Never put a Node `Buffer` inside a JSON payload — without the old global reviver, `JSON.stringify` serialises Buffers as huge `{type: 'Buffer', data: [n…]}` arrays. If a body genuinely needs binary, encode it locally with `value.toString('base64')` at that handler; binary data belongs in file/stream endpoints (`res.sendFile`, the HLS `data.ts` routes).
- Error bodies always come from the central middleware (`server/src/middleware/error-handler.ts`) as `{message}` JSON: `BaseRequestError.statusCode`, a status carried on the thrown value (`err.status`/`err.statusCode`, e.g. body-parser's 400), or warned 500 for unknowns. There is no content negotiation — any Accept header gets JSON, and the old 503-on-non-JSON-Accept gate is gone.
- Deliberate wire deltas that came with those rules: `/cache{/*splat}` 400s are `{message:`-only (the unused `type: 'config'` field is gone), pre-route failures (body-parser 400s, `sendFile` 404s) answer JSON through the middleware, while Express's unmatched-route 404 stays the default HTML page.
- Pinned in `server/src/api-tests/errors.spec.ts` and `server/src/test/error-handler.ts`; refactor after re-checking those first.

## Gotchas

- Server runtime reads from `dist/`, not `src/` — after editing server or common code you must rebuild (`common` first, then `server`) before running or testing.
- SQLite migrations live in `server/src/database/sqlite/migrations/` as numbered `.sql` files; a new migration must be added there and is picked up by `copy.sh` during build.
- Config JSON allows comments (`strip-json-comments`); schemas are strict (`--required --noExtraProps`), so new config fields must be added to the `common` types.
- CI: `.github/workflows/tests.yml` runs the API stability and database suites on PRs and master pushes. `.github/workflows/docker-image.yml` builds the Docker image on PRs to validate the Dockerfile without publishing, and publishes to `simplyboo6/vimtur` from master and tags.
- `create-schemas.sh` hash-caches its output on the *source .d.ts hashes only*, so bumping TypeScript or typescript-json-schema does NOT trigger regeneration — delete `.schema-build-info` first or you compare stale artifacts and can "pass" while actually generating different schemas.
- Dev (`yarn build`) and prod (`yarn build:prod`) client builds write the same `client/dist/`, and the server serves it — a dev build clobbers the production bundle; re-run `build:prod` after any dev build.
- `onnxruntime-node` ships prebuilt glibc binaries (Alpine/musl is unsupported — the Docker base is `node:24-slim` for this reason) and recompiles nothing per Node bump, but Yarn 4 depends on `ONNXRUNTIME_NODE_INSTALL=skip` being set (it cannot read the npm-config route). The SQLite backend uses the built-in `node:sqlite` (`DatabaseSync`, Node 24+ required) — no native compilation, and its worker runs explicit `BEGIN`/`COMMIT`/`ROLLBACK` for transaction batches since `node:sqlite` has no `db.transaction()` helper.
- The MongoDB driver major must match supported servers (driver 7: servers 4.4–8); `run-tests.sh` takes `MONGO_TEST_IMAGE` to point the disposable container at any of them (defaults to `mongo:4.4` because MongoDB ≥5 requires AVX hardware).

## Video streaming architecture (visible in `server/src/routes/images.ts`, `server/src/cache/`, `client/src/app/components/video-player/`)

- Video is streamed via HLS: a VOD m3u8 whose segments are keyed off ffprobe keyframes, served as `data.ts?start=X&end=Y`. Each segment is either pre-cached on disk or transcodes on demand via `streamMedia` (input seeks with `-ss <X> -t <end-start>`). Note the on-disk cache filenames literally contain `?start=…&end=…`, don't "fix" that.
- `metadata.length` is `Math.ceil(duration)` (rounded up, ~1s slack); segment `end` values derived from keyframes can drift past it, so clamp segment ranges against `metadata.length` rather than throwing (see `streamMedia`, `buildSegments`, `generateStreamPlaylist`).
- The ONLY error handler for hls.js lives in the video player component and must implement recovery: on a fatal error hls.js calls stopLoad() internally and *expects the app* to call `startLoad()` (network errors) or `recoverMediaError()`; without it playback continues from buffer until the next seek then freezes. Client aborts (seeking away) intentionally SIGKILL ffmpeg — `ImportUtils.transcode` distinguishes that via an `outputClosed` flag set on the response's close event; exit 255 is only success when the output actually closed.
- Streaming endpoints (`data.ts` segments) write the response body directly, so once the first byte is sent the status can't change — errors after that can only `res.end()`. Report pre-stream failures with a proper JSON error status (see `respondStreamError` in `routes/images.ts`), and keep long-lived cache headers (`Cache-Control: immutable`) on the pre-cached branch only, so a truncated/failed transcode can't be cached for a week.

## Client toolchain constraints

- Native `<progress>` fills need per-engine handling (see `video-player.component.scss`): Firefox paints the fill from `color`, Chromium/Safari normally from `accent-color` — but **only while the element has no authored background**; `background-color: transparent` on the element flips Chromium into legacy painting, where the fill comes from `::-webkit-progress-value` and `accent-color` is ignored. Set `color`, `accent-color`, and explicit `::-webkit-progress-bar`/`::-webkit-progress-value` rules. Note `getComputedStyle(el, '::-webkit-progress-value')` reports `rgba(0, 0, 0, 0)` in Chromium even when the rule applies — verify with pixels, not computed style.
- hls.js packaged types (e.g. `ErrorData`) are importable from `hls.js` directly.
- Angular's `HttpClient` runs on `FetchBackend` (the `withXhr()` XHR-transport parity from #147 was dropped in #148; `HttpXhrBackend` is tree-shaken out of the bundle). No `reportProgress`/upload-progress usage exists anywhere — if one is ever added, note fetch has no upload progress, which would need XHR or a different design. Also XHR-only observables never existed here: no `HTTP_INTERCEPTORS`, so bare `provideHttpClient()` is correct as-is.
- Plain `import X from '@vimtur/common'` (not `import type`) is the established style for cross-package imports; TS elides type-only usage.

## Dependency-upgrade lessons (from the master modernisation)

Non-obvious things that cost real debugging time — re-check these when bumping majors again:

- **TypeScript majors**: `typescript-json-schema` vendors its own TS version (`~5.9.x`) and its schemas output must stay byte-stable (see Dev flow #5), while `eslint-plugin-import-x`'s resolver (`unrs-resolver`) and `@typescript-eslint` declare TS support windows (`<6.1`) — check **both** before upgrading the compiler past a patch-line; TS 6/7 are not yet usable here at the time of writing.
- **ESLint 9/10 is flat config only**: no `--ext` flag (it errors silently-shaped CLI failures), `eslint-plugin-import` is superseded by `import-x` and rules are referenced as `import-x/*`; `eslint-import-resolver-typescript` must be an explicit devDependency or resolution rules crash with "typescript with invalid interface loaded as resolver".
- **Angular `ng update` on Yarn 4**: hoisted-dep duplication (`@jridgewell/sourcemap-codec`) can make the update migration silently no-op or crash — `yarn dedupe --strategy highest` recovers; `ng update <pkg> --migrate-only --from/--to` reruns any missed migration.
- **Angular 21+ boots zoneless by default**: `bootstrapApplication` installs `NoopNgZone` unless `provideZoneChangeDetection` is provided, so nothing schedules change detection for async work (raw service subscriptions assigning component fields) — fresh loads wedge on the initial Loading template even though services settle (see #133; the `eventCoalescing` flag in the original workaround was a no-op red herring). The explicit `provideZoneChangeDetection()` in `client/src/app/app.config.ts` is required, and is paired with the zone.js import in `client/src/polyfills.ts` (dropping that import throws NG0908 instead of silently failing). If the view doesn't move while logs do, suspect missing scheduler notification for async work.
- The `@typescript-eslint` "recommended-requiring-type-checking" preset got renamed (`recommendedTypeChecked`) and its v8 rules are sharper — expect new lint findings (dead assertions, missing `{ cause }` on rethrows, `preserve-caught-error`) rather than a config change.
- Express 5 uses path-to-regexp v8: legacy `:param(*)` segment captures must become `{/*splat}` optional groups, and path/query params are typed `string | string[]` (repeated keys are possible at runtime) — use the `singleParam()` helper in `server/src/utils` rather than non-null assertions.
- `yarn serve` proxy keys are **micromatch globs**, not Express patterns: `*` never crosses a `/`, so `/api/*` silently stops matching nested paths like `/api/images/subset` (404 that looks like it comes from Express but is the dev server). Use `/api/**` for nested paths; `/socket*` still matches socket.io's `/socket.io/` pathname as-is.
- Driver majors: read the upstream CHANGELOG for API shape changes our layer uses (`findOneAndUpdate` result unwrapping, `collection.update` removal) and verify the driver against a LIVE server per version matrix, not only unit tests — the mocha suite runs on sqlite.
