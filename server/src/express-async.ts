import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { BadRequest } from './errors';
import { BaseRequestError } from './errors/base';

const DEFAULT_FORMAT = 'application/json';

export interface RestResult {
  status?: number;
  data?: any;
}

export interface ExpressArgs {
  req: Request;
  res: Response;
  next: NextFunction;
}

export type Handler<T, A> = (args: ExpressArgs & A) => Promise<T>;
export type Extractor<A> = (args: ExpressArgs) => A;

const empty = {};
const noOpExtractor: Extractor<{}> = () => empty;

export type WrapHandler<A> = Handler<any, A>;

export function jsonReviver(_: any, value: any): any {
  if (typeof value === 'object' && value.type === 'Buffer' && value.data) {
    return Buffer.from(value.data, 'base64');
  }
  return value;
}

function sendResponse(req: Request, res: Response, status: number, response?: any): void {
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
  switch (type) {
    case 'application/json': // Fallthrough
    case '*/*':
      res.set('Content-Type', 'application/json');
      res.status(status).send(
        Buffer.from(
          JSON.stringify(response, (_, value) => {
            // Buffers when bassed through stringify send up in a structure like:
            // { type: 'Buffer', data: [10, 20, 30] }
            // This expression checks if it meets that format and if it does, it strigifes the buffer as base64.
            return value && value.type === 'Buffer' && Array.isArray(value.data)
              ? { type: 'Buffer', data: Buffer.from(value.data).toString('base64') }
              : value;
          }),
          'utf8',
        ),
      );
      break;
    default:
      throw new BadRequest(`Unexpected content type: ${type}`);
  }
}

export function wrapHandler<A>(
  handler: WrapHandler<A>,
  extractor: Extractor<A>,
  sendResult: boolean,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const express: ExpressArgs = { req, res, next };
      const result = await handler({
        ...express,
        ...extractor(express),
      });

      if (sendResult) {
        if (result) {
          sendResponse(req, res, result.status || 200, result.data);
        } else {
          res.sendStatus(204);
        }
      }
    } catch (err) {
      if (err.message.startsWith('Unexpected content type')) {
        console.error(
          'Unable to send error response because of unexpected content type',
          req.header('content-type'),
        );
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
    }
  };
}

export function wrap(handler: WrapHandler<{}>, sendResult = true): RequestHandler {
  return wrapHandler(handler, noOpExtractor, sendResult);
}
