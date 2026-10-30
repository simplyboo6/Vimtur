import 'source-map-support/register';

import { expect } from 'chai';
import type Express from 'express';
import { describe, it } from 'mocha';

import { BadRequest } from '../errors/bad-request';
import { NotFound } from '../errors/not-found';
import { errorHandler } from '../middleware/error-handler';

// Minimal request/response stand-ins for the error-handler middleware: it only
// touches res.status().json()/sendStatus/headersSent and req.header(). The
// recorded outcome is on `statusCode` to keep it separate from the
// Express-shaped chainable `status()` method.
interface FakeResponse {
  headersSent: boolean;
  statusCode?: number;
  body?: unknown;
  status(code: number): FakeResponse;
  json(body: unknown): void;
  sendStatus(code: number): void;
}

function fakeResponse(): FakeResponse {
  const res: FakeResponse = {
    headersSent: false,
    status: (code: number) => {
      // Mutation-like Express: setting a status alone writes nothing, so
      // headersSent stays false until something is actually sent.
      res.statusCode = code;
      return res;
    },
    json: (body: unknown) => {
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

function fakeRequest(): Express.Request {
  return {
    header: () => undefined,
  } as unknown as Express.Request;
}

function callError(res: FakeResponse, err: unknown): unknown[] {
  const forwarded: unknown[] = [];
  const next: Express.NextFunction = (arg?: unknown) => {
    forwarded.push(arg);
  };
  errorHandler(err, fakeRequest(), res as unknown as Express.Response, next);
  return forwarded;
}

describe('Error handler middleware', () => {
  it('maps BaseRequestError subclasses to their status code with a {message} body', () => {
    const res = fakeResponse();
    callError(res, new BadRequest('No fields to update'));
    expect(res.statusCode).to.equal(400);
    expect(res.body).to.deep.equal({ message: 'No fields to update' });

    const notFound = fakeResponse();
    callError(notFound, new NotFound('No media found with hash: abc'));
    expect(notFound.statusCode).to.equal(404);
  });

  it('maps unknown errors to a 500 carrying the message', () => {
    const res = fakeResponse();
    callError(res, new Error('database exploded'));
    expect(res.statusCode).to.equal(500);
    expect(res.body).to.deep.equal({ message: 'database exploded' });

    // Non-Error throws (e.g. bare rejection values) are normalised as well.
    const stringThrow = fakeResponse();
    callError(stringThrow, 'boom');
    expect(stringThrow.statusCode).to.equal(500);
    expect(stringThrow.body).to.deep.equal({ message: 'boom' });
  });

  it('honours a status carried by the thrown value, not the normalised error', () => {
    // body-parser forwards parse failures with status 400 set, and they must
    // not be demoted to unknown-error 500s. asError() turns non-Error
    // throwables into a fresh Error and drops their extras, so the status is
    // read off the raw thrown value.
    const res = fakeResponse();
    const err: Error & { status?: number } = new Error('Unexpected token } in JSON');
    err.status = 400;
    callError(res, err);
    expect(res.statusCode).to.equal(400);

    const objectCarrier = fakeResponse();
    callError(objectCarrier, { status: 404, message: 'gone' });
    expect(objectCarrier.statusCode).to.equal(404);
    expect(objectCarrier.body).to.deep.equal({ message: 'gone' });

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
});
