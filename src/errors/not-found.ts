import { BaseRequestError } from './base';

export class NotFound extends BaseRequestError {
  public readonly statusCode = 404;

  public constructor(message: string) {
    super(message);
  }
}
