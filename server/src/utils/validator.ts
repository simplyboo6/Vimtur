import Ajv, { ValidateFunction } from 'ajv';
import FS from 'fs';
import Path from 'path';

export interface ValidatorResult {
  success: boolean;
  errorText?: string;
}

if (!require.main) {
  throw new Error('require.main missing');
}

const ROOT_DIR = Path.dirname(require.main.filename);
const SCHEMA_PATH = process.env['SCHEMA_PATH'] || `${ROOT_DIR}/schemas`;

export class Validator {
  private validator: ValidateFunction;
  private ajv: Ajv.Ajv;

  public static loadSchema(name: string, version?: string): any {
    const path = version ? `${SCHEMA_PATH}/${name}.${version}.json` : `${SCHEMA_PATH}/${name}.json`;
    const rawSchema = FS.readFileSync(path);
    return JSON.parse(rawSchema.toString());
  }

  public static load(name: string, version?: string): Validator {
    const schemaJson = Validator.loadSchema(name, version);

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
