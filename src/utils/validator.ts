import * as FS from 'fs';
import * as Util from 'util';
import Ajv, { ValidateFunction } from 'ajv';

export interface ValidatorResult {
  success: boolean;
  errorText?: string;
}

export class Validator {
  private validator: ValidateFunction;
  private ajv: Ajv.Ajv;

  public static async load(path: string): Promise<Validator> {
    if (!path) {
      throw new Error('Definition path must be defined');
    }
    const rawSchema = await Util.promisify(FS.readFile)(path);
    const schemaJson = JSON.parse(rawSchema.toString());

    const ajv = new Ajv({
      allErrors: true,
      verbose: true,
      coerceTypes: true,
    });
    return new Validator(ajv, ajv.compile(schemaJson));
  }

  private constructor(ajv: Ajv.Ajv, validator: ValidateFunction) {
    this.ajv = ajv;
    this.validator = validator;
  }

  public validate(data: object): ValidatorResult {
    const success = this.validator(data) as boolean;
    return {
      success,
      errorText: success ? undefined : this.ajv.errorsText(this.validator.errors),
    };
  }
}
