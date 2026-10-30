import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { BaseRequestError } from './errors/base';
import { asError } from './utils';
import { sendResponse } from './utils/send-response';

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

/**
 * @deprecated Use a plain `async (req, res)` handler that throws
 * `BadRequest`/`NotFound` — Express 5 forwards failures to the central
 * error-handler middleware (`middleware/error-handler.ts`), so handlers can use
 * `sendResponse` (utils/send-response.ts) directly and let errors bubble up.
 */
export function wrap(handler: WrapHandler<Record<string, unknown>>, sendResult = true): RequestHandler {
  return wrapHandler(handler, noOpExtractor, sendResult);
}
