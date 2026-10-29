import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { BadRequest } from './errors';
import { BaseRequestError } from './errors/base';
import { asError } from './utils';

const DEFAULT_FORMAT = 'application/json';

export interface RestResult {
  status?: number;
  data?: unknown;
}

export interface ExpressArgs {
  req: Request;
  res: Response;
  next: NextFunction;
}

// Handlers may return plain values or Promises; wrapHandler awaits both. Sync
// handlers are useful where nothing awaits inside and no awaiting caller wraps them.
export type Handler<T, A extends object = Record<string, unknown>> = (args: ExpressArgs & A) => T | Promise<T>;
export type Extractor<A extends object> = (args: ExpressArgs) => A;

const empty = {};
const noOpExtractor: Extractor<Record<string, unknown>> = () => empty;

export type WrapHandler<A extends object = Record<string, unknown>> = Handler<void | RestResult, A>;

function sendResponse(req: Request, res: Response, status: number, response?: unknown): void {
  if (response === undefined) {
    res.sendStatus(status);
    return;
  }

  let type = req.header('accept') ?? req.header('content-type') ?? DEFAULT_FORMAT;
  // To cope with type being a list of things.
  if (type.includes(',')) {
    if (type.includes('application/json')) {
      type = 'application/json';
    }
    if (type.includes('*/*')) {
      type = '*/*';
    }
  }
  // Buffers when passed through stringify arrive in a structure like:
  // { type: 'Buffer', data: [10, 20, 30] }
  // This checks if it meets that format and re-encodes the buffer as base64.
  function bufferBase64Reviver(_key: string, value: unknown): unknown {
    if (typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'Buffer') {
      const data = (value as { data?: unknown }).data;
      if (Array.isArray(data)) {
        return { type: 'Buffer', data: Buffer.from(data as number[]).toString('base64') };
      }
    }
    return value;
  }
  switch (type) {
    case 'application/json': // Fallthrough
    case '*/*':
      res.set('Content-Type', 'application/json');
      res.status(status).send(Buffer.from(JSON.stringify(response, bufferBase64Reviver), 'utf8'));
      break;
    default:
      throw new BadRequest(`Unexpected content type: ${type}`);
  }
}

export function wrapHandler<A extends object>(
  handler: WrapHandler<A>,
  extractor: Extractor<A>,
  sendResult: boolean,
): RequestHandler {
  return (req, res, next) => {
    (async () => {
      const express: ExpressArgs = { req, res, next };
      const result = await handler({
        ...express,
        ...extractor(express),
      });

      if (sendResult) {
        if (result !== undefined) {
          sendResponse(req, res, result.status || 200, result.data);
        } else {
          res.sendStatus(204);
        }
      }
    })().catch((errUnknown: unknown) => {
      const err = asError(errUnknown);
      if (err.message.startsWith('Unexpected content type')) {
        console.error('Unable to send error response because of unexpected content type', req.header('content-type'));
        res.sendStatus(503);
        return;
      }

      try {
        if (err instanceof BaseRequestError) {
          sendResponse(req, res, err.statusCode, { message: err.message });
        } else {
          console.warn('Unknown Error', err);
          sendResponse(req, res, 500, { message: err.message });
        }
      } catch (resErr) {
        console.error('Error sending error response', resErr);
      }
    });
  };
}

export function wrap(handler: WrapHandler<Record<string, unknown>>, sendResult = true): RequestHandler {
  return wrapHandler(handler, noOpExtractor, sendResult);
}
