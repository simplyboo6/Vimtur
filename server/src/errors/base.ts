export abstract class BaseRequestError extends Error {
  public abstract readonly statusCode: number;
}
