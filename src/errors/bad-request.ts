import { BaseRequestError } from './base';

export class BadRequest extends BaseRequestError {
  public readonly statusCode = 400;

  public constructor(message: string) {
    super(message);
  }
}
