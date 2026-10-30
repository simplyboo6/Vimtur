import 'source-map-support/register';

import { expect } from 'chai';
import type Express from 'express';
import { describe, it } from 'mocha';

import { BadRequest } from '../errors/bad-request';
import { NotFound } from '../errors/not-found';
import { errorHandler } from '../middleware/error-handler';
import { sendResponse } from '../utils/send-response';

// Minimal request/response stand-ins for the error-handler middleware: it only
// touches res.set/status/send/sendStatus/headersSent and req.header(). The
// recorded outcome is on `statusCode` to keep it separate from the
// Express-shaped chainable `status()` method.
interface FakeResponse {
  headers: Record<string, string>;
  headersSent: boolean;
  statusCode?: number;
  body?: unknown;
  set(name: string, value: string): void;
  status(code: number): FakeResponse;
  send(body: unknown): void;
  sendStatus(code: number): void;
}

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    headers: {},
    headersSent: false,
    set: (name: string, value: string) => {
      res.headers[name] = value;
    },
    status: (code: number) => {
      // Mutation-like Express: setting a status alone writes nothing, so
      // headersSent stays false until something is actually sent.
      res.statusCode = code;
      return res;
    },
    send: (body: unknown) => {
      res.body = body;
      res.headersSent = true;
    },
    sendStatus: (code: number) => {
      res.statusCode = code;
      res.headersSent = true;
    },
  };
  return res;
}

function fakeRequest(accept?: string): Express.Request {
  return {
    header: (name: string) => (name === 'accept' ? accept : undefined),
  } as unknown as Express.Request;
}

function callError(res: FakeResponse, err: unknown, accept = 'application/json'): unknown[] {
  const forwarded: unknown[] = [];
  const next: Express.NextFunction = (arg?: unknown) => {
    forwarded.push(arg);
  };
  errorHandler(err, fakeRequest(accept), res as unknown as Express.Response, next);
  return forwarded;
}

describe('Error handler middleware', () => {
  it('maps BaseRequestError subclasses to their status code with a {message} body', () => {
    const res = fakeResponse();
    callError(res, new BadRequest('No fields to update'));
    expect(res.statusCode).to.equal(400);
    expect(JSON.parse(res.body as string)).to.deep.equal({ message: 'No fields to update' });

    const notFound = fakeResponse();
    callError(notFound, new NotFound('No media found with hash: abc'));
    expect(notFound.statusCode).to.equal(404);
  });

  it('maps unknown errors to a 500 carrying the message', () => {
    const res = fakeResponse();
    callError(res, new Error('database exploded'));
    expect(res.statusCode).to.equal(500);
    expect(JSON.parse(res.body as string)).to.deep.equal({ message: 'database exploded' });

    // Non-Error throws (e.g. bare rejection values) are normalised as well.
    const stringThrow = fakeResponse();
    callError(stringThrow, 'boom');
    expect(stringThrow.statusCode).to.equal(500);
    expect(JSON.parse(stringThrow.body as string)).to.deep.equal({ message: 'boom' });
  });

  it('honours a status already carried by middleware-level errors', () => {
    // body-parser forwards parse failures with status 400 set, and they must
    // not be demoted to unknown-error 500s.
    const res = fakeResponse();
    const err: Error & { status?: number } = new Error('Unexpected token } in JSON');
    err.status = 400;
    callError(res, err);
    expect(res.statusCode).to.equal(400);
  });

  it('reads carried statuses off the thrown value, not the normalised error', () => {
    // asError() turns non-Error throwables into a fresh Error and drops their
    // extras; a plain object carrying status must still map via that status.
    const res = fakeResponse();
    callError(res, { status: 404, message: 'gone' });
    expect(res.statusCode).to.equal(404);
    expect(JSON.parse(res.body as string)).to.deep.equal({ message: 'gone' });

    const statusCodeCarrier = fakeResponse();
    callError(statusCodeCarrier, { statusCode: 413, message: 'entity too large' });
    expect(statusCodeCarrier.statusCode).to.equal(413);

    // A status outside the HTTP error range is not trusted as a mapping.
    const ignored = fakeResponse();
    callError(ignored, { status: 200, message: 'lies' });
    expect(ignored.statusCode).to.equal(500);
  });

  it('defers to the default handler when headers are already sent', () => {
    const res = fakeResponse();
    res.headersSent = true;
    const thrown = new BadRequest('name not specified');
    const forwarded = callError(res, thrown);
    expect(forwarded).to.have.lengthOf(1);
    // The original error object is forwarded untouched.
    expect(forwarded[0]).to.equal(thrown);
    expect(res.statusCode).to.equal(undefined);
  });

  it('maps un-negotiable content types to a 503', () => {
    // A handler that produced a body but hit an Accept/Content-Type header
    // that sendResponse cannot negotiate throws BadRequest with this message;
    // the error handler reports the response failure as a 503.
    const res = fakeResponse();
    callError(res, new BadRequest('Unexpected content type: text/html'));
    expect(res.statusCode).to.equal(503);
  });
});

describe('sendResponse', () => {
  it('serialises Buffers as base64', () => {
    const res = fakeResponse();
    sendResponse(fakeRequest('application/json'), res as unknown as Express.Response, 200, {
      image: Buffer.from([10, 20, 30]),
    });
    expect(res.statusCode).to.equal(200);
    expect(JSON.parse(res.body as string)).to.deep.equal({ image: { type: 'Buffer', data: 'ChQe' } });
  });

  it('sends empty responses with no body', () => {
    const res = fakeResponse();
    sendResponse(fakeRequest(), res as unknown as Express.Response, 204);
    expect(res.statusCode).to.equal(204);
    expect(res.body).to.equal(undefined);
  });
});
