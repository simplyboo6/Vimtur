import FS from 'fs';
import Path from 'path';

import Ajv, { ValidateFunction } from 'ajv';

import { BadRequest } from '../errors';

const ROOT_DIR = Path.resolve(__dirname, '..');
const SCHEMA_PATH = process.env['SCHEMA_PATH'] ?? `${ROOT_DIR}/schemas`;

export class Validator<T extends object = object> {
  private validator: ValidateFunction;
  private ajv: Ajv;

  private constructor(ajv: Ajv, validator: ValidateFunction) {
    this.ajv = ajv;
    this.validator = validator;
  }

  public static loadSchema(name: string, version?: string): object {
    const path = version ? `${SCHEMA_PATH}/${name}.${version}.json` : `${SCHEMA_PATH}/${name}.json`;
    const rawSchema = FS.readFileSync(path);
    // The schema shape is owned by ajv's compile() below, which validates it.
    return JSON.parse(rawSchema.toString()) as object;
  }

  public static load<U extends object>(name: string, version?: string): Validator<U> {
    const schemaJson = Validator.loadSchema(name, version);

    const ajv = new Ajv({
      allErrors: true,
      verbose: true,
      coerceTypes: true,
    });
    return new Validator<U>(ajv, ajv.compile(schemaJson));
  }

  public validate(data: unknown): T {
    const success = this.validator(data);
    if (!success) {
      // Consumers of this class fail requests that carry invalid bodies, so a
      // validation failure is a client error carrying the Ajv text.
      throw new BadRequest(this.ajv.errorsText(this.validator.errors));
    }
    // The claim that `data` is a `T` rests purely on this Ajv run: the loaded
    // schema was generated from T (Validator.load<T>), and coerceTypes mutates
    // the value in place, so `data` is the validated value itself. This is
    // the only place a request body's shape is claimed without hand-written
    // narrowing behind it.
    return data as T;
  }
}
