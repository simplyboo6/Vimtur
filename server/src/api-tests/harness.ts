// Black-box API test harness.
//
// These tests boot the compiled server (dist/index.js) as a subprocess and
// talk to it exclusively over HTTP. They exist to lock down API stability for
// internal refactors, so files in this directory must never import server
// internals — only Node builtins, @vimtur/common types, and this harness.

import { type ChildProcess, execFile, spawn } from 'child_process';
import FS from 'fs';
import Net from 'net';
import OS from 'os';
import Path from 'path';
import { promisify } from 'util';

import type { Media, QueuedTask } from '@vimtur/common';

const execFileAsync = promisify(execFile);

const READY_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 250;
// Generous default; individual waits must stay under the mocha timeout.
const DEFAULT_DRAIN_TIMEOUT_MS = 90_000;
const DRAIN_POLL_MS = 250;

export interface StartServerOptions {
  // 'memory' (default) boots with an in-memory SQLite database, which the
  // sqlite controller runs with a single worker. 'file' boots with a
  // throwaway SQLite file inside the temp root.
  dbMode?: 'memory' | 'file';
}

export interface ApiServer {
  port: number;
  baseUrl: string;
  // Path of the media library (DATA_PATH) the server was started with.
  libraryPath: string;
  cachePath: string;
  stop(): Promise<void>;
}

export async function startServer(options: StartServerOptions = {}): Promise<ApiServer> {
  const tmpBase = FS.existsSync('/tmp/opencode') ? '/tmp/opencode' : OS.tmpdir();
  const root = FS.mkdtempSync(Path.join(tmpBase, 'vimtur-api-'));
  const libraryPath = Path.join(root, 'library');
  const cachePath = Path.join(root, 'cache');
  const dbMode = options.dbMode ?? 'memory';
  // The server treats database.path as a directory and appends 'vimtur.db'.
  const dbDir = Path.join(root, 'db');
  const dbPath = dbMode === 'file' ? dbDir : ':memory:';
  FS.mkdirSync(libraryPath, { recursive: true });
  FS.mkdirSync(cachePath, { recursive: true });
  if (dbMode === 'file') {
    FS.mkdirSync(dbDir, { recursive: true });
  }

  // The user config layer keeps runs offline and fast: TensorFlow needs
  // python/g++/make and internet access on first use, and phash is CPU-heavy.
  const configPath = Path.join(root, 'config.json');
  FS.writeFileSync(configPath, JSON.stringify({ enableTensorFlow: false, enablePhash: false }));

  const logPath = Path.join(root, 'server.log');
  // From dist/api-tests the server entrypoint and generated schemas are
  // sibling paths inside dist/.
  const serverEntry = Path.resolve(__dirname, '..', 'index.js');
  const schemasPath = Path.resolve(__dirname, '..', 'schemas');

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await getFreePort();
    const logFd = FS.openSync(logPath, 'a');
    let child: ChildProcess | undefined;
    try {
      child = spawn(process.execPath, [serverEntry], {
        stdio: ['ignore', logFd, logFd],
        detached: true,
        env: {
          ...process.env,
          PORT: String(port),
          DATABASE: 'sqlite',
          DATABASE_PATH: dbPath,
          DATA_PATH: libraryPath,
          CACHE_PATH: cachePath,
          SCHEMA_PATH: schemasPath,
          CONFIG_PATH: configPath,
        },
      });
      const spawned = child;
      await waitUntilReady(port, child, logPath);
      return {
        port,
        baseUrl: `http://127.0.0.1:${port}`,
        libraryPath,
        cachePath,
        stop: () => stopServer(spawned, root),
      };
    } catch (err: unknown) {
      lastError = err;
      if (child && child.pid) {
        killProcessGroup(child.pid, 'SIGKILL');
        await waitForExit(child, 5_000).catch(() => undefined);
      }
    } finally {
      // The child inherited its own copy of the descriptor; release ours.
      FS.closeSync(logFd);
    }
  }

  throw new Error(
    `Server failed to start after 3 attempts: ${asMessage(lastError)}\n--- server.log ---\n${logTail(logPath)}`,
  );
}

export interface ApiResponse<T = unknown> {
  status: number;
  // Parsed JSON when the response is JSON, otherwise the raw text. `null` for
  // empty bodies.
  data: T | string | null;
}

export class ApiClient {
  private readonly baseUrl: string;

  public constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  public async request<T>(method: string, path: string, body?: unknown): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    });
    const text = await response.text();
    let data: T | string | null = null;
    if (text.length > 0) {
      if ((response.headers.get('content-type') ?? '').includes('application/json')) {
        data = JSON.parse(text) as T;
      } else {
        data = text;
      }
    }
    return { status: response.status, data };
  }

  public get<T>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path);
  }

  public post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body ?? {});
  }

  public put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body ?? {});
  }

  public patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PATCH', path, body ?? {});
  }

  public delete<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path, body);
  }

  // Fetches a response body as raw bytes (e.g. media files, segments).
  public async getBinary(path: string): Promise<{ status: number; bytes: Buffer; contentType: string | null }> {
    const response = await fetch(`${this.baseUrl}${path}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, bytes, contentType: response.headers.get('content-type') };
  }
}

export function assertOk<T>(response: ApiResponse<T>, context: string): T {
  if (response.status < 200 || response.status > 299) {
    throw new Error(`${context}: expected a 2xx status, got ${response.status}: ${preview(response)}`);
  }
  return response.data as T;
}

export function assertStatus<T>(response: ApiResponse<T>, status: number, context: string): T | string | null {
  if (response.status !== status) {
    throw new Error(`${context}: expected status ${status}, got ${response.status}: ${preview(response)}`);
  }
  return response.data;
}

// Creates a small still image in the library. `filename` may include
// subdirectories relative to the library root.
export async function createStill(libraryPath: string, filename: string, color: string, size = 64): Promise<void> {
  const target = Path.join(libraryPath, filename);
  FS.mkdirSync(Path.dirname(target), { recursive: true });
  await execFileAsync('gm', ['convert', '-size', `${size}x${size}`, `xc:${color}`, target]);
}

// Creates a tiny synthetic video in the library. `filename` may include
// subdirectories relative to the library root.
export async function createVideo(
  libraryPath: string,
  filename: string,
  options: { duration?: number; size?: number } = {},
): Promise<void> {
  const duration = options.duration ?? 2;
  const size = options.size ?? 128;
  const target = Path.join(libraryPath, filename);
  FS.mkdirSync(Path.dirname(target), { recursive: true });
  await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc=duration=${duration}:size=${size}x${size}:rate=10`,
    '-pix_fmt',
    'yuv420p',
    '-y',
    target,
  ]);
}

export async function queueTask(client: ApiClient, id: string, args?: unknown): Promise<string> {
  const response = await client.post<string>(`/api/tasks/queue/${id}`, args ?? {});
  return assertOk(response, `POST /api/tasks/queue/${id}`);
}

// POSTs search constraints and returns the matching hashes.
export async function subset(client: ApiClient, constraints: object): Promise<string[]> {
  return assertOk(await client.post<string[]>('/api/images/subset', constraints), 'POST /api/images/subset');
}

// Fetches full media detail by hash.
export async function detail(client: ApiClient, hash: string): Promise<Media> {
  return assertOk(await client.get<Media>(`/api/images/${hash}`), `GET /api/images/${hash}`);
}

// Queues a task and waits until the task queue has fully drained. Completed
// tasks are removed from the queue (autoClearCompletedTasks defaults to true),
// and a meta-task like AUTO-IMPORT queues its subtasks synchronously before it
// can itself be removed, so an empty queue is a reliable "everything finished"
// signal. Fails early if any task ends with an error.
export async function runTaskAndWait(
  client: ApiClient,
  id: string,
  args?: unknown,
  timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS,
): Promise<void> {
  await queueTask(client, id, args);
  await waitForDrainedQueue(client, { timeoutMs });
}

export async function waitForDrainedQueue(client: ApiClient, options: { timeoutMs?: number } = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await client.get<QueuedTask[]>('/api/tasks/queue');
    const queue = assertOk(response, 'GET /api/tasks/queue');
    const failed = queue.filter((task) => task.error);
    if (failed.length > 0) {
      throw new Error(`Task(s) failed: ${failed.map((task) => `${task.id}: ${task.error}`).join('; ')}`);
    }
    if (queue.length === 0) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`Task queue did not drain within ${timeoutMs}ms. Remaining: ${JSON.stringify(queue)}`);
    }
    await sleep(DRAIN_POLL_MS);
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = Net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        server.close(() => resolve(address.port));
      } else {
        server.close(() => reject(new Error('Failed to allocate a free port')));
      }
    });
  });
}

async function waitUntilReady(port: number, child: ChildProcess, logPath: string): Promise<void> {
  const url = `http://127.0.0.1:${port}/api/version`;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let exited = false;
  child.once('exit', () => {
    exited = true;
  });
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(
        `Server exited before becoming ready (code: ${child.exitCode}).\n--- server.log ---\n${logTail(logPath)}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.text();
        return;
      }
    } catch {
      // Not accepting connections yet; keep polling.
    }
    await sleep(READY_POLL_MS);
  }
  throw new Error(`Server did not become ready within ${READY_TIMEOUT_MS}ms.\n--- server.log ---\n${logTail(logPath)}`);
}

async function stopServer(child: ChildProcess, root: string): Promise<void> {
  if (child.pid) {
    killProcessGroup(child.pid, 'SIGTERM');
    try {
      await waitForExit(child, 5_000);
    } catch {
      killProcessGroup(child.pid, 'SIGKILL');
      await waitForExit(child, 5_000).catch(() => undefined);
    }
  }
  FS.rmSync(root, { recursive: true, force: true });
}

function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    // Negative pid targets the whole process group (the server is spawned
    // detached), so ffmpeg/gm children started by tasks die with the server.
    process.kill(-pid, signal);
  } catch {
    // Already exited.
  }
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error(`Process did not exit within ${timeoutMs}ms`));
    }, timeoutMs);
    const onExit = (): void => {
      clearTimeout(timer);
      resolve();
    };
    child.once('exit', onExit);
  });
}

function logTail(logPath: string, lines = 40): string {
  try {
    const content = FS.readFileSync(logPath, 'utf8');
    const all = content.split('\n');
    return all.slice(Math.max(0, all.length - lines)).join('\n');
  } catch {
    return '(no server log available)';
  }
}

function preview(response: ApiResponse<unknown>): string {
  return JSON.stringify(response.data).slice(0, 400);
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
