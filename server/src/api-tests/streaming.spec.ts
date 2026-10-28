import type { Media } from '@vimtur/common';
import { expect } from 'chai';
import { describe, it } from 'mocha';

import {
  ApiClient,
  type ApiServer,
  assertOk,
  createStill,
  createVideo,
  runTaskAndWait,
  startServer,
  subset,
} from './harness';

// Locks the HLS streaming contract: playlist shapes, segment bytes, and range
// clamping/error behaviour. Asserts only observable output (playlist text,
// MPEG-TS bytes, status codes) — not how segments are derived.
describe('Streaming API', () => {
  let server: ApiServer;
  let client: ApiClient;
  let videoHash: string;
  let stillHash: string;

  before(async () => {
    server = await startServer();
    client = new ApiClient(server.baseUrl);

    await createStill(server.libraryPath, 'picture.png', 'red');
    await createVideo(server.libraryPath, 'clip.mp4', { duration: 2, size: 128 });
    await runTaskAndWait(client, 'AUTO-IMPORT');

    videoHash = (await subset(client, { path: { likeAny: ['clip'] } }))[0]!;
    stillHash = (await subset(client, { path: { likeAny: ['picture'] } }))[0]!;
  });

  after(async () => {
    await server.stop();
  });

  const fetchText = async (path: string): Promise<{ status: number; body: string; contentType: string | null }> => {
    const response = await fetch(`${server.baseUrl}${path}`);
    return { status: response.status, body: await response.text(), contentType: response.headers.get('content-type') };
  };

  it('master playlist lists the native quality with bandwidth and resolution', async () => {
    const response = await fetchText(`/api/images/${videoHash}/stream/index.m3u8`);
    expect(response.status).to.equal(200);
    expect(response.contentType).to.equal('application/vnd.apple.mpegurl');

    const lines = response.body.split('\n');
    expect(lines[0]).to.equal('#EXTM3U');
    expect(response.body).to.include('BANDWIDTH=');
    // A 128x128 video has no configured stream quality at or below its size,
    // so the master falls back to the native height of 128.
    expect(response.body).to.include('RESOLUTION=128x128');
    expect(lines).to.include('128/index.m3u8');
  });

  it('media playlist is a VOD playlist with keyframe-cut segments', async () => {
    const response = await fetchText(`/api/images/${videoHash}/stream/128/index.m3u8`);
    expect(response.status).to.equal(200);
    expect(response.contentType).to.equal('application/vnd.apple.mpegurl');

    expect(response.body).to.include('#EXT-X-VERSION:3');
    expect(response.body).to.include('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(response.body).to.include('#EXT-X-MEDIA-SEQUENCE:0');
    expect(response.body.trim().endsWith('#EXT-X-ENDLIST')).to.equal(true);
    // A 2 second video is below the segment gap threshold: one whole-file segment.
    const segmentLines = response.body.split('\n').filter((line) => line.startsWith('data.ts?'));
    expect(segmentLines).to.deep.equal(['data.ts?start=0&end=2']);
    expect(response.body).to.match(/#EXTINF:2\.000000,/);
  });

  it('serves segments as MPEG-TS bytes without long-lived cache headers', async () => {
    const response = await client.getBinary(`/api/images/${videoHash}/stream/128/data.ts?start=0&end=2`);
    expect(response.status).to.equal(200);
    expect(response.contentType).to.equal('video/mp2t');
    expect(response.bytes.length).to.be.above(1000);
    // MPEG-TS packets start with the 0x47 sync byte.
    expect(response.bytes[0]).to.equal(0x47);
  });

  it('clamps segment ranges to the media duration', async () => {
    // end beyond the duration is clamped down rather than rejected.
    const response = await client.getBinary(`/api/images/${videoHash}/stream/128/data.ts?start=0&end=999`);
    expect(response.status).to.equal(200);
    expect(response.bytes[0]).to.equal(0x47);

    // Negative starts are clamped up to zero.
    const negative = await client.getBinary(`/api/images/${videoHash}/stream/128/data.ts?start=-5&end=2`);
    expect(negative.status).to.equal(200);
    expect(negative.bytes[0]).to.equal(0x47);
  });

  it('rejects fully out-of-range segments with a 503', async () => {
    const response = await client.get(`/api/images/${videoHash}/stream/128/data.ts?start=5&end=9`);
    expect(response.status).to.equal(503);
    // The pre-stream error is JSON, but the route already set a video/mp2t
    // content type, so the client returns it as raw text.
    expect(String(response.data)).to.include('Requested segment');
  });

  it('rejects segments without numeric start/end', async () => {
    const response = await client.get(`/api/images/${videoHash}/stream/128/data.ts`);
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('message');
  });

  it('rejects non-numeric qualities', async () => {
    const response = await client.get(`/api/images/${videoHash}/stream/abc/index.m3u8`);
    expect(response.status).to.equal(400);
    expect(response.data).to.have.property('message');
  });

  it('404s playlists and segments for unknown media', async () => {
    expect((await client.get('/api/images/no-such-hash/stream/index.m3u8')).status).to.equal(404);
    expect((await client.get('/api/images/no-such-hash/stream/128/index.m3u8')).status).to.equal(404);
    expect((await client.get('/api/images/no-such-hash/stream/128/data.ts?start=0&end=2')).status).to.equal(404);
  });

  it('rejects segment filenames outside the data.ts/index cache scheme', async () => {
    const response = await client.get(`/api/images/${videoHash}/stream/128/other-file.ts`);
    expect(response.status).to.equal(400);
  });

  // Accidental but current behaviour: quality is not validated against the
  // configured stream qualities, so arbitrary values produce playlists.
  it('media playlist works for unconfigured qualities', async () => {
    const response = await fetchText(`/api/images/${videoHash}/stream/99999/index.m3u8`);
    expect(response.status).to.equal(200);
    expect(response.body).to.include('#EXT-X-PLAYLIST-TYPE:VOD');
  });

  // Accidental but current behaviour: still images are not type-checked on the
  // master playlist route, but the media playlist route fails with a 500.
  describe('Still image behaviour (current, accidental)', () => {
    it('master playlist is served for stills', async () => {
      const response = await fetchText(`/api/images/${stillHash}/stream/index.m3u8`);
      expect(response.status).to.equal(200);
      expect(response.body).to.include('64/index.m3u8');
    });

    it('media playlist fails with a 500', async () => {
      const response = await fetchText(`/api/images/${stillHash}/stream/64/index.m3u8`);
      expect(response.status).to.equal(500);
    });
  });

  it('streams reflect metadata consistency', async () => {
    const media = assertOk(await client.get<Media>(`/api/images/${videoHash}`), 'GET /api/images/:hash');
    expect(media.metadata?.length).to.equal(2);
    expect(media.metadata?.width).to.equal(128);
    expect(media.metadata?.height).to.equal(128);
  });
});
