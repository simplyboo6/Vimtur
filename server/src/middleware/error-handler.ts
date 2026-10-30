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
// runs before the routes (body-parser, http-auth, express's own sendFile) also
// forward here and carry a status on the error object, which Express's default
// handler used to honour — respect it so those stay 4xx instead of becoming
// unknown-error 500s.
export const errorHandler: ErrorRequestHandler = (errUnknown, req, res, next) => {
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
  // mapping.
  if (err.message.startsWith('Unexpected content type')) {
    console.error('Unable to send error response because of unexpected content type', req.header('content-type'));
    res.sendStatus(503);
    return;
  }

  let status = 500;
  if (err instanceof BaseRequestError) {
    status = err.statusCode;
  } else {
    // Errors thrown outside the routes (e.g. body-parser) carry their status
    // as `status` or `statusCode`, which is what Express's default handler
    // used to honour.
    const known = (err as { status?: unknown }).status ?? (err as { statusCode?: unknown }).statusCode;
    if (typeof known === 'number' && known >= 400 && known < 600) {
      status = known;
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
