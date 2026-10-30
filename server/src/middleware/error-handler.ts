import type { ErrorRequestHandler } from 'express';

import { BaseRequestError } from '../errors/base';
import { asError } from '../utils';
import { sendResponse } from '../utils/send-response';

// Central error-handler middleware. Express 5 forwards rejected promises (and
// sync throws) from handlers here, which is what the deprecated wrap() used to
// catch itself. Response bodies follow the existing error contract:
// BaseRequestError subclasses map to their status code, anything else is an
// unexpected 500 (warned), and both send { message }.
//
// Not all errors reaching this middleware come from handlers. Middleware that
// runs before the routes (body-parser, http-auth) and the sendFile fallback in
// express's `send` also forward here and carry a status on the error object,
// which Express's default handler used to honour — respect it so those stay
// 4xx instead of becoming unknown-error 500s.
export const errorHandler: ErrorRequestHandler = (errUnknown, req, res, next) => {
  // asError() normalises non-Error throwables into a fresh Error without
  // their extra fields, so read any carried-over status off the original
  // value, not the normalised error.
  const attached = errUnknown as { status?: unknown; statusCode?: unknown };
  const err = asError(errUnknown);

  // Handlers that write the body directly (HLS segments, media files) may
  // throw after the first byte is already out; the status can no longer
  // change, so hand off to Express's default handler which ends the response.
  if (res.headersSent) {
    next(err);
    return;
  }

  // sendResponse throws BadRequest when the Accept/Content-Type header cannot
  // be negotiated; reporting that failure as a 503 comes before the normal
  // mapping. This is also where a plain res.json()-style error body would
  // fail for stream responses; images.ts has its own respondStreamError for
  // that case so a status is only attempted while the response is still
  // changeable there.
  if (err.message.startsWith('Unexpected content type')) {
    console.error(
      'Unable to send error response because of unexpected content type',
      req.header('accept'),
      req.header('content-type'),
    );
    res.sendStatus(503);
    return;
  }

  let status = 500;
  if (err instanceof BaseRequestError) {
    status = err.statusCode;
  } else {
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

  try {
    sendResponse(req, res, status, { message: err.message });
  } catch (resErr) {
    console.error('Error sending error response', resErr);
  }
};
