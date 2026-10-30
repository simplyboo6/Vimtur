import type { Request, Response } from 'express';

import { BadRequest } from '../errors';

const DEFAULT_FORMAT = 'application/json';

// Shared response sender for API handlers. Buffers passed through
// JSON.stringify arrive in a structure like { type: 'Buffer', data: [10, 20, 30]
// }; the reviver re-encodes them as base64, which is the wire format binary
// payloads (thumbnails, previews) are documented against. Negotiated from the
// Accept header with a Content-Type fallback because fetch-style clients may
// not send Accept at all.
export function sendResponse(req: Request, res: Response, status: number, response?: unknown): void {
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
      // Thrown while a response is being sent, so the error handler maps this
      // to a 503 rather than re-running the negotiation.
      throw new BadRequest(`Unexpected content type: ${type}`);
  }
}
