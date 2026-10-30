import type { ErrorRequestHandler } from 'express';

import { BaseRequestError } from '../errors/base';
import { asError } from '../utils';

// Central error-handler middleware. Express 5 forwards rejected promises (and
// sync throws) from handlers here, which is what the deprecated wrap() used to
// catch itself. Response bodies follow the existing error contract:
// BaseRequestError subclasses map to their status code, anything else is an
// unexpected 500 (warned), and both send { message }. There is no content
// negotiation: error bodies go out through res.json() whatever the client
// asked for in Accept.
export const errorHandler: ErrorRequestHandler = (errUnknown, _req, res, next) => {
  // asError() normalises non-Error throwables into a fresh Error without
  // their extras, so read any carried-over status off the raw thrown value.
  const attached = errUnknown as { status?: unknown; statusCode?: unknown };
  const err = asError(errUnknown);

  // Handlers that write the body directly (HLS segments, media files) may
  // throw after the first byte is already out; the status can no longer
  // change, so hand off to Express's default handler which ends the response.
  // A failing stream reports its own truncation through respondStreamError in
  // images.ts instead.
  if (res.headersSent) {
    next(err);
    return;
  }

  let status = 500;
  if (err instanceof BaseRequestError) {
    status = err.statusCode;
  } else {
    // Errors thrown outside the handlers (body-parser, sendFile, auth
    // middleware) carry their status as `status` or `statusCode`, which is
    // what Express's default handler used to honour.
    const known = attached.status ?? attached.statusCode;
    if (typeof known === 'number' && known >= 400 && known < 600) {
      status = known;
      // Expected client-side failures (4xx) stay quiet; an upstream-looking
      // 5xx still gets context in the logs.
      if (known >= 500) {
        console.warn('Error carrying HTTP status', known, ',', err);
      }
    } else {
      console.warn('Unknown Error', err);
    }
  }

  res.status(status).json({ message: err.message });
};
