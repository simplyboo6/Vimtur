const Validator = require('jsonschema').Validator;
const FS = require('fs');
const Path = require('path');

const v = new Validator();
const schema = JSON.parse(FS.readFileSync(Path.resolve(__dirname, 'media.schema.json')));
console.log(`Validating ${process.argv[2]}...`);
const media = JSON.parse(FS.readFileSync(process.argv[2]));

console.log(v.validate(media, schema));
