const DeepMerge = require('deepmerge');
const Ajv = require('ajv');
const BetterAjvErrors = require('better-ajv-errors');
const FS = require('fs');
const Args = require('args');
const PathIsInside = require('path-is-inside');
const Path = require('path');

Args.option('config', 'The config file to to overlay');

function mapEnv(env, obj, dest) {
    const path = dest.split('.');
    if (process.env[env]) {
        console.log(`Using ${process.env[env]} from ${env}`);
        let node = obj;
        for (let i = 0; i < path.length - 1; i++) {
            if (!node[path[i]]) {
                node[path[i]] = {};
            }
            node = node[path[i]];
        }

        let value = process.env[env];
        if (!isNaN(value)) {
            value = Number(value);
        }
        node[path[path.length - 1]] = value;
    }
}

class Config {
    constructor(schema) {
        this.schema = schema;
    }

    get(path) {
        if (!path) {
            return this.merged;
        }

        let obj = this.merged;
        for (const item of path.split('.')) {
            // Do this before to allow the last level to be undefined.
            if (!obj) {
                throw new Error(`Path not found (${path}) at segment (${item}).`);
            }
            obj = obj[item];
        }
        return obj;
    }

    setLayers(layers) {
        const layerArray = [];
        if (this.baseLayers) {
            layerArray.push(...this.baseLayers);
            if (layers.database) {
                throw new Error('User config layer cannot contain database config.');
            }
            if (layers.libraryPath) {
                throw new Error('User config layer cannot contain the library path.');
            }
            if (layers.cachePath) {
                throw new Error('User config layer cannot contain the cache path.');
            }
        }
        layerArray.push(...layers);

        const merged = DeepMerge.all(layerArray);
        const schemaValidate = Ajv().compile(this.schema);
        if (!schemaValidate(merged)) {
            console.error(BetterAjvErrors(this.schema, merged, schemaValidate.errors), schemaValidate.errors);
            throw new Error('Merged configuration schema failed to validate.');
        }
        // On the first call store the layers as the write-once base layers.
        if (!this.baseLayers) {
            // Some additional validation.
            if (PathIsInside(Path.resolve(merged.cachePath), Path.resolve(merged.libraryPath))) {
                throw new Error('Cache folder cannot be inside the library');
            }
            this.baseLayers = layers;
        }
        // Otherwise don't store the layers because they're stored in the database.
        this.merged = merged;
    }

    static getEnvironmentLayer() {
        const config = {};
        // General config
        mapEnv('PORT', config, 'port');
        mapEnv('DATA_PATH', config, 'libraryPath');
        mapEnv('CACHE_PATH', config, 'cachePath');
        mapEnv('USERNAME', config, 'username');
        mapEnv('PASSWORD', config, 'password');
        // Database mapping
        mapEnv('DATABASE', config, 'database.provider');
        // Common database configuration options.
        mapEnv('DATABASE_HOST', config, 'database.host');
        mapEnv('DATABASE_DATABASE', config, 'database.database');
        mapEnv('DATABASE_USERNAME', config, 'database.username');
        mapEnv('DATABASE_PASSWORD', config, 'database.password');
        mapEnv('DATABASE_PORT', config, 'database.port');

        return config;
    }

    static getUserLayer() {
        const flags = Args.parse(process.argv);
        const path = flags.config || process.env['CONFIG_PATH'];
        if (!path) {
            // The user layer is optional.
            return {};
        }
        return JSON.parse(FS.readFileSync(path));
    }

    static init() {
        const schema = JSON.parse(FS.readFileSync(`${__dirname}/config.schema.json`));
        // Load the constant layers, all of these together should validate.
        // They may be overwritten at runtime though.
        const defaults = JSON.parse(FS.readFileSync(`${__dirname}/config.defaults.json`));
        const userConfig = Config.getUserLayer();
        const environment = Config.getEnvironmentLayer();
        const config = new Config(schema);
        // Order matters, userConfig over-writes default and environment over-writes userConfig.
        config.setLayers([defaults, userConfig, environment]);

        return config;
    }
}

module.exports = Config.init();
