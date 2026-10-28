import type { Configuration } from '@vimtur/common';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import { ApiClient, type ApiServer, assertOk, assertStatus, startServer } from './harness';

describe('API smoke tests', () => {
  let server: ApiServer;
  let client: ApiClient;

  before(async () => {
    server = await startServer();
    client = new ApiClient(server.baseUrl);
  });

  after(async () => {
    await server.stop();
  });

  describe('Version', () => {
    it('reports a version string', async () => {
      const response = await client.get<string>('/api/version');
      const version = assertOk(response, 'GET /api/version');
      expect(version).to.be.a('string').and.to.have.lengthOf.at.least(1);
    });
  });

  describe('Config', () => {
    it('serves configuration without database details', async () => {
      const response = await client.get<Configuration.Main>('/api/config');
      const config = assertOk(response, 'GET /api/config');
      expect(config).to.be.an('object');
      expect(config).to.not.have.property('database');
      expect(config.libraryPath).to.equal(server.libraryPath);
      expect(config.cachePath).to.equal(server.cachePath);
      expect(config.port).to.equal(server.port);
    });

    it('accepts a configuration update and reflects it back', async () => {
      const getResponse = await client.get<Configuration.Main>('/api/config');
      const config = assertOk(getResponse, 'GET /api/config');

      const update = { ...config, user: { ...config.user, galleryImageCount: 7 } };
      const postResponse = await client.post<Configuration.Main>('/api/config', update);
      const updated = assertOk(postResponse, 'POST /api/config');
      expect(updated.user.galleryImageCount).to.equal(7);

      const recheck = assertOk(await client.get<Configuration.Main>('/api/config'), 'GET /api/config');
      expect(recheck.user.galleryImageCount).to.equal(7);
    });
  });

  describe('Error envelope', () => {
    it('returns a 404 JSON error for unknown media', async () => {
      const response = await client.get<{ message: string }>('/api/images/definitely-not-a-hash');
      expect(response.status).to.equal(404);
      expect(response.data).to.have.property('message');
    });

    it('returns a 400 JSON error for invalid search constraints', async () => {
      const response = await client.post<{ message: string }>('/api/images/subset', { quality: 'not-a-number' });
      expect(response.status).to.equal(400);
      expect(response.data).to.have.property('message');
    });

    it('returns a 400 JSON error when creating a tag without a tag', async () => {
      const response = await client.post<{ message: string }>('/api/tags', {});
      expect(response.status).to.equal(400);
      expect(response.data).to.have.property('message');
    });

    it('returns 404 for unknown API routes', async () => {
      const response = await client.get('/api/this-route-does-not-exist');
      expect(response.status).to.equal(404);
    });

    it('does not leak stack traces in error bodies', async () => {
      const response = await client.get<{ message: string }>('/api/images/definitely-not-a-hash');
      const data = assertStatus(response, 404, 'GET /api/images/<unknown>');
      const message = (data as { message: string }).message;
      expect(message).to.be.a('string');
      expect(message).to.not.match(/at .*\(/);
    });
  });
});
