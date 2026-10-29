import FS from 'fs';

import type { Scanner } from '@vimtur/common';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
  ApiClient,
  type ApiServer,
  assertOk,
  createStill,
  createVideo,
  detail,
  runTaskAndWait,
  startServer,
  subset,
} from './harness';

// The full import journey: seed files on disk, import them through the task
// API, verify the media surface, then exercise the SCAN → INDEX and
// SCAN → DELETE-MISSING pipelines, and manual deletion.
//
// Note: SCAN results describe *pending* work — INDEX and DELETE-MISSING
// consume (clear) their respective lists when they run.
describe('Import lifecycle', () => {
  let server: ApiServer;
  let client: ApiClient;
  // path (library-relative) → hash
  let pathToHash: Record<string, string>;

  const refreshPathMap = async (): Promise<void> => {
    pathToHash = {};
    for (const hash of await subset(client, {})) {
      const media = await detail(client, hash);
      pathToHash[media.path] = media.hash;
    }
  };

  const scanResults = async (): Promise<Scanner.Summary> => {
    return assertOk(await client.get<Scanner.Summary>('/api/tasks/SCAN/results'), 'GET /api/tasks/SCAN/results');
  };

  before(async () => {
    server = await startServer();
    client = new ApiClient(server.baseUrl);

    await createStill(server.libraryPath, 'red.png', 'red');
    await createStill(server.libraryPath, 'green.jpg', 'green');
    await createStill(server.libraryPath, 'nested/blue.png', 'blue');
    await createVideo(server.libraryPath, 'clip.mp4', { duration: 2 });
  });

  after(async () => {
    await server?.stop();
  });

  it('starts with an empty library', async () => {
    expect(await subset(client, {})).to.deep.equal([]);
  });

  it('AUTO-IMPORT imports every supported file in the library', async () => {
    await runTaskAndWait(client, 'AUTO-IMPORT');

    const hashes = await subset(client, {});
    expect(hashes).to.have.lengthOf(4);

    await refreshPathMap();
    expect(Object.keys(pathToHash).sort()).to.deep.equal(['clip.mp4', 'green.jpg', 'nested/blue.png', 'red.png']);
  });

  it('media detail is fully populated for stills', async () => {
    const media = await detail(client, pathToHash['red.png']);
    expect(media.hash).to.equal(pathToHash['red.png']);
    expect(media.path).to.equal('red.png');
    expect(media.dir).to.equal('.');
    expect(media.type).to.equal('still');
    expect(media.tags).to.deep.equal([]);
    expect(media.actors).to.deep.equal([]);
    expect(media.playlists).to.deep.equal([]);
    expect(media.corrupted).to.equal(false);
    expect(media.thumbnail).to.equal(true);
    expect(media.metadata?.width).to.equal(64);
    expect(media.metadata?.height).to.equal(64);
    expect(media.metadata?.createdAt).to.be.a('number');
    expect(media.absolutePath).to.equal(`${server.libraryPath}/red.png`);
  });

  it('media detail is fully populated for videos', async () => {
    const media = await detail(client, pathToHash['clip.mp4']);
    expect(media.type).to.equal('video');
    expect(media.metadata?.width).to.be.above(0);
    expect(media.metadata?.height).to.be.above(0);
    expect(media.metadata?.length).to.be.at.least(2);
    expect(media.thumbnail).to.equal(true);
  });

  it('nested files keep their relative directory', async () => {
    const media = await detail(client, pathToHash['nested/blue.png']);
    expect(media.dir).to.equal('nested');
  });

  it('serves the raw file bytes', async () => {
    const response = await client.getBinary(`/api/images/${pathToHash['red.png']}/file`);
    expect(response.status).to.equal(200);
    expect(response.contentType).to.include('image/png');
    const expected = FS.readFileSync(`${server.libraryPath}/red.png`);
    expect(response.bytes.equals(expected)).to.equal(true);
  });

  it('supports the download flag with a content disposition', async () => {
    const response = await fetch(`${server.baseUrl}/api/images/${pathToHash['red.png']}/file?download=1`);
    expect(response.status).to.equal(200);
    expect(response.headers.get('content-disposition')).to.include('attachment');
    expect(response.headers.get('content-disposition')).to.include('red.png');
    await response.arrayBuffer();
  });

  it('re-importing without changes leaves no pending scan results', async () => {
    await runTaskAndWait(client, 'AUTO-IMPORT');

    expect(await subset(client, {})).to.have.lengthOf(4);
    await runTaskAndWait(client, 'SCAN');
    expect(await scanResults()).to.deep.equal({ newPaths: 0, missingPaths: 0 });
  });

  it('a standalone SCAN reports new files and INDEX consumes them', async () => {
    await createStill(server.libraryPath, 'yellow.png', 'yellow');

    await runTaskAndWait(client, 'SCAN');
    expect(await scanResults()).to.deep.equal({ newPaths: 1, missingPaths: 0 });
    const newPaths = assertOk(
      await client.get<string[]>('/api/tasks/SCAN/results/new'),
      'GET /api/tasks/SCAN/results/new',
    );
    expect(newPaths).to.deep.equal(['yellow.png']);

    await runTaskAndWait(client, 'INDEX');
    expect(await subset(client, {})).to.have.lengthOf(5);
    await refreshPathMap();
    expect(pathToHash['yellow.png']).to.be.a('string').and.to.have.lengthOf.at.least(1);

    // INDEX consumed the pending list.
    expect(await scanResults()).to.deep.equal({ newPaths: 0, missingPaths: 0 });
  });

  it('DELETE-MISSING removes media whose files disappeared', async () => {
    FS.unlinkSync(`${server.libraryPath}/green.jpg`);

    await runTaskAndWait(client, 'SCAN');
    expect(await scanResults()).to.deep.equal({ newPaths: 0, missingPaths: 1 });
    const missingPaths = assertOk(
      await client.get<string[]>('/api/tasks/SCAN/results/missing'),
      'GET /api/tasks/SCAN/results/missing',
    );
    expect(missingPaths).to.deep.equal(['green.jpg']);

    // This tiny library is 5 media large at this point, so a single missing
    // file exceeds the 10% threshold and the explicit opt-out safety mode is
    // required here.
    await runTaskAndWait(client, 'DELETE-MISSING', ['allow-all']);
    expect(await subset(client, {})).to.have.lengthOf(4);
    expect(await client.get(`/api/images/${pathToHash['green.jpg']}`)).to.have.property('status', 404);

    // DELETE-MISSING consumed the pending list.
    expect(await scanResults()).to.deep.equal({ newPaths: 0, missingPaths: 0 });
  });

  it('DELETE /api/images/:hash removes media through the API', async () => {
    const response = await client.delete(`/api/images/${pathToHash['red.png']}`);
    expect(response.status).to.equal(204);

    expect(await subset(client, {})).to.have.lengthOf(3);
    expect(await client.get(`/api/images/${pathToHash['red.png']}`)).to.have.property('status', 404);
    expect(await client.get(`/api/images/${pathToHash['red.png']}/file`)).to.have.property('status', 404);
  });
});
