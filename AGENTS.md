# AGENTS.md

## Repo structure

- Three-package TypeScript project: `common/` (shared types, `@vimtur/common`), `server/` (Node/Express + Socket.io backend), `client/` (Angular 16 frontend). Uses Yarn 4 (`corepack enable`); each package has its own `yarn.lock`.
- `common/src` contains only `.d.ts` declaration files (media, search, config, playlist, etc). Both server and client depend on it via `yarn link --relative ../common` from their own directory. If imports from `@vimtur/common` fail, re-run that link after `yarn` install.
- Server entrypoint: `server/src/index.ts`; runs from `dist/`. Client dev build output goes to `client/dist/`, which the server serves.

## Commands (run inside the relevant package directory)

- Build server: `yarn build` in `server/` — runs `tsc`, then `create-schemas.sh` (generates JSON schemas from the `.d.ts` types in `common` into `dist/schemas`, hash-cached in `.schema-build-info`), then `copy.sh` (copies SQLite migrations to `dist/`). Deleting `dist/` alone is not enough — schema/migration files come from these scripts.
- Server tests: from repo root run `./run-tests.sh` — it starts a disposable Mongo container on port 27020, sets `DATABASE`/`DATA_PATH`/`CACHE_PATH`/`SCHEMA_PATH` env vars, and runs `yarn test` (mocha against compiled `dist/test`). Server must be built first. Docker is required.
- Run a single server test: `cd server && TEST_MODE=1 mocha --timeout 30000 dist/test/database.ts` requires building first; tests compile only via `tsc`.
- Lint/format: `yarn lint` / `yarn fix` in each package (server: eslint; client: `ng lint` + prettier; common: eslint).
- Client dev server: `yarn serve` in `client/` (port 8455, proxies to backend via `proxy-config.json`).

## Running locally

- Native run uses env vars (see `env-sqlite.sh`): `PORT`, `DATABASE` (`sqlite` default | `mongodb`), `DATABASE_URI`/`DATABASE_DB` for mongo, plus `DATA_PATH` (media library) and `CACHE_PATH` (must be outside `DATA_PATH`). These override `config.json` (format: `Configuration.Main` in `common/src/config.d.ts`; example in `server/config.json.example`).
- Requires system binaries outside Docker: `ffmpeg`, `graphicsmagick` (`gm`), and optionally `pngquant`, `gallery-dl`, `yt-dlp`.
- `@tensorflow/tfjs-node` needs python3/g++/make to build and internet access on first model use.

## Gotchas

- Server runtime reads from `dist/`, not `src/` — after editing server or common code you must rebuild (`common` first, then `server`) before running or testing.
- SQLite migrations live in `server/src/database/sqlite/migrations/` as numbered `.sql` files; a new migration must be added there and is picked up by `copy.sh` during build.
- Config JSON allows comments (`strip-json-comments`); schemas are strict (`--required --noExtraProps`), so new config fields must be added to the `common` types.
- CI (`.github/workflows/docker-image.yml`) only validates the Docker build on master; Docker images publish to `simplyboo6/vimtur` from master and tags.
