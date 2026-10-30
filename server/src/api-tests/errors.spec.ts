// Locks the error→HTTP mapping that lives in the central error-handler
// middleware (middleware/error-handler.ts). These endpoints deliberately
// exercise each branch of that mapping — handler-thrown request errors,
// middleware-level errors, stream pre-byte failures and content negotiation —
// so refactoring the middleware cannot silently change a status code or body
// shape. All failures run against a server booting a standalone SQLite server.
import { expect } from 'chai';
import { describe, it } from 'mocha';

import { ApiClient, type ApiServer, createStill, detail, runTaskAndWait, startServer, subset } from './harness';

describe('Error envelope', () => {
  let server: ApiServer;
  let client: ApiClient;
  let alpha: string;

  before(async () => {
    server = await startServer();
    client = new ApiClient(server.baseUrl);

    await createStill(server.libraryPath, 'alpha.png', 'red');
    await runTaskAndWait(client, 'AUTO-IMPORT');
    alpha = (await detail(client, (await subset(client, { path: { likeAny: ['alpha'] } }))[0])).hash;
  });

  after(async () => {
    await server?.stop();
  });

  // Raw fetch helpers, because the ApiClient always stringifies JSON bodies
  // and never sets Accept — both of which these pins are about.
  async function rawRequest(
    method: string,
    path: string,
    options: { body?: string; accept?: string; contentType?: string } = {},
  ): Promise<{ status: number; body: string; contentType: string | null }> {
    const headers: Record<string, string> = {};
    if (options.accept) {
      headers['accept'] = options.accept;
    }
    if (options.contentType) {
      headers['content-type'] = options.contentType;
    }
    const response = await fetch(`${server.baseUrl}${path}`, { method, headers, body: options.body });
    return { status: response.status, body: await response.text(), contentType: response.headers.get('content-type') };
  }

  it('maps handler NotFound throws to a 404 with the exact message', async () => {
    const response = await client.get<{ message: string }>('/api/images/definitely-not-a-hash');
    expect(response.status).to.equal(404);
    expect(response.data).to.deep.equal({ message: 'No media found with hash: definitely-not-a-hash' });
  });

  it('maps handler BadRequest throws to a 400 with the exact message', async () => {
    const response = await client.post<{ message: string }>(`/api/images/${alpha}/tags`, {});
    expect(response.status).to.equal(400);
    expect(response.data).to.deep.equal({ message: 'name not specified' });
  });

  it('unknown errors map to a 500 carrying the message', async () => {
    // POSTing an array where a Configuration.Partial object is required makes
    // the config handler throw a plain Error while merging the request body
    // (POST /api/config's DeepMerge.all call); the central handler warns and
    // maps it to 500 with the message, as wrap() did. If that merge site
    // ever starts throwing a BaseRequestError instead, this pin legitimately
    // flips to 400 — nothing else about the middleware changes then.
    // Note the failing write happens before anything is persisted.
    const response = await client.post('/api/config', []);
    expect(response.status).to.equal(500);
    expect(response.data).to.have.property('message');
  });

  it('responds 503 with a plain-text body to an un-negotiable Accept header', async () => {
    const response = await rawRequest('GET', '/api/tags', { accept: 'text/html' });
    expect(response.status).to.equal(503);
    expect(response.body).to.equal('Service Unavailable');
  });

  it('keeps the data wire format plain JSON for acceptable content types', async () => {
    const response = await rawRequest('GET', '/api/tags', { accept: 'application/json' });
    expect(response.status).to.equal(200);
    expect(response.contentType).to.equal('application/json; charset=utf-8');
  });

  it('parses unparseable JSON bodies as 400, not 500', async () => {
    // body-parser forwards here with err.status already set; the mapping
    // keeps it instead of demoting it to an unknown-error 500.
    const response = await rawRequest('POST', '/api/tags', {
      body: '{"tag": ',
      contentType: 'application/json',
    });
    expect(response.status).to.equal(400);
  });

  it('maps stream pre-byte failures to the normal JSON error body', async () => {
    // Non-video media is rejected outright by the streaming handler, proving
    // a pre-byte handler throw arrives as the standard JSON body.
    const response = await client.get(`/api/images/${alpha}/stream/128/data.ts?start=0&end=2`);
    expect(response.status).to.equal(400);
    expect(response.data).to.deep.equal({ message: 'Cannot stream non-video media' });
  });

  it('rejects cache paths outside the cache directory with a plain 400 body', async () => {
    // The /cache file route throws BadRequest into the central handler like
    // the /api routes do; the historical type: 'config' extras field is gone.
    const response = await rawRequest('GET', '/cache/..%2Fdata.txt');
    expect(response.status).to.equal(400);
    expect(response.body).to.equal(JSON.stringify({ message: 'File is not inside cache directory' }));
  });

  it('serves sendFile failures as JSON, not the express default page', async () => {
    // Errors forwarded by res.sendFile (missing files) reach the middleware
    // with their status attached, so the default HTML error page — which
    // would otherwise print a stack trace — becomes a JSON body instead.
    // Paths appear verbatim in the message; the whole library path is
    // public API on a no-auth install, so this leaks nothing new.
    const missing = await rawRequest('GET', '/cache/does-not-exist.png');
    expect(missing.status).to.equal(404);
    expect(missing.contentType).to.include('application/json');
    const missingBody = JSON.parse(missing.body) as { message: string };
    expect(missingBody.message).to.include('ENOENT');

    const webMissing = await rawRequest('GET', '/web/dist/definitely-missing.js');
    expect(webMissing.status).to.equal(404);
    expect(webMissing.contentType).to.include('application/json');
  });
});
