const auth = require('http-auth');
const path = require('path');
const FS = require('fs');
const RimRaf = require('rimraf');
const PathIsInside = require('path-is-inside');

exports.usage = function () {
    const prog = process.argv[0] + ' ' + process.argv[1];
    console.log('Usage: ' + prog + ' </path/to/config.json>');
};

exports.config = {
    'port': 3523
};

async function saveFile(file, data) {
    return new Promise((resolve, reject) => {
        FS.writeFile(file, data, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

async function readFile(file) {
    return new Promise((resolve, reject) => {
        FS.readFile(file, (err, data) => {
            if (err) {
                reject(err);
            } else {
                resolve(data);
            }
        });
    });
}

async function loadConfig(file) {
    const data = await readFile(file);
    try {
        return JSON.parse(data);
    } catch (err) {
        console.log('Error parsing config JSON', err, data);
        throw err;
    }
}

function mapEnv(env, obj, dest) {
    if (process.env[env]) {
        console.log(`Using ${process.env[env]} from ${env}`);
        let node = obj;
        for (let i = 0; i < dest.length - 1; i++) {
            obj[dest] = process.env[env];
            if (!node[dest[i]]) {
                node[dest[i]] = {};
            }
            node = node[dest[i]];
        }
        node[dest[dest.length - 1]] = process.env[env];
        if (!isNaN(node[dest[dest.length - 1]])) {
            node[dest[dest.length - 1]] = parseInt(node[dest[dest.length - 1]]);
        }
    }
}

exports.setup = async function() {
    // First, find if there's a config path.
    // First load in CONFIG_PATH, if the command-line argument is set,
    // then use that instead. Lastly if CACHE_PATH is set then derive a config path.
    mapEnv('CONFIG_PATH', exports, ['configPath']);
    exports.configPath = process.env['CONFIG_PATH'];
    if (process.argv.length > 2) {
        exports.configPath = process.argv[process.argv.length - 1];
    }
    if (!exports.configPath && !process.env['CACHE_PATH']) {
        console.log('Please specify either CONFIG_PATH, CACHE_PATH or a config on the command line');
        process.exit(0);
    }
    if (!exports.configPath) {
        exports.configPath = `${process.env['CACHE_PATH']}/config.json`;
    }
    exports.configPath = path.resolve(exports.configPath);
    console.log(`Using '${exports.configPath}' as config`);
    try {
        exports.config = await loadConfig(exports.configPath);
        console.log(`Loaded config from ${exports.configPath}`);
    } catch (err) {
        console.log(`Unable to load an existing config from ${exports.configPath}`);
    }

    // Load these environment variables after loading the configuration
    // so that the environment variables can over-write the config.

    // General config
    mapEnv('PORT', exports, ['config', 'port']);
    mapEnv('DATA_PATH', exports, ['config', 'libraryPath']);
    mapEnv('CACHE_PATH', exports, ['config', 'cachePath']);
    mapEnv('USERNAME', exports, ['config', 'username']);
    mapEnv('PASSWORD', exports, ['config', 'password']);
    // Database mapping
    mapEnv('DATABASE', exports, ['config', 'database', 'provider']);
    // MongoDB
    mapEnv('MONGO_HOST', exports, ['config', 'database', 'host']);
    mapEnv('MONGO_DATABASE', exports, ['config', 'database', 'database']);
    mapEnv('MONGO_USERNAME', exports, ['config', 'database', 'username']);
    mapEnv('MONGO_PASSWORD', exports, ['config', 'database', 'password']);
    mapEnv('MONGO_PORT', exports, ['config', 'database', 'port']);

    await exports.validateConfig();
};

exports.isSetup = async function() {
    if (exports.configValid) {
        return true;
    }
    await exports.validateConfig();
    return true;
};

exports.saveConfig = async function(config) {
    // There's two sorts of config updates. User settings and server settings.
    // Currently the server settings are updated from a separate page than the
    // user settings. So if the user object is set then only save the new user setting.
    if (config.user) {
        if (!exports.config.user) {
            exports.config.user = {};
        }
        Object.assign(exports.config.user, config.user);
    } else {
        await exports.validateConfig(config);
        exports.config = config;
        exports.configValid = false;
        await exports.validateConfig();
    }
    await saveFile(exports.configPath, JSON.stringify(exports.config, null, 2));
    console.log(`Config file saved to ${exports.configPath}`);
};

async function exists(file) {
    return new Promise((resolve) => {
        FS.access(file, FS.constants.F_OK, (err) => {
            resolve(err ? false : true);
        });
    });
}

exports.validateConfig = async function(config) {
    let updateConfigValidity = false;
    if (!config) {
        updateConfigValidity = true;
        config = exports.config;
    }
    if (!config.libraryPath) {
        throw new Error('Library path not set.');
    }
    if (!(await exists(config.libraryPath))) {
        throw new Error('Library path does not exist');
    }
    if (!config.cachePath) {
        throw new Error('Cache path not set.');
    }
    if (PathIsInside(path.resolve(config.cachePath), path.resolve(config.libraryPath))) {
        throw new Error('Cache folder cannot be inside the library');
    }
    if (!config.database) {
        throw new Error('No database provider defined');
    }
    switch (config.database.provider) {
    case 'mongodb':
        if (!config.database.host) {
            throw new Error('Database host not defined');
        }
        if (!config.database.database) {
            throw new Error('Database not defined');
        }
        break;
    default:
        throw new Error(`Unknown database provider: ${config.database.provider}`);
    }
    if (!config.database.provider) {
        throw new Error('Database provider not set');
    }
    if (updateConfigValidity) {
        exports.configValid = true;
    }
};

if (exports.config.libraryPath) {
    console.log('Using library: ' + exports.config.libraryPath);
} else {
    console.log('No library directory set');
}

if (exports.config.cachePath) {
    console.log('Using cache: ' + exports.config.cachePath);
} else {
    console.log('No cache directory set');
}

exports.authConnector = function (req, res, next) {
    next();
};

if (exports.config.username != undefined && exports.config.password != undefined) {
    const basicAuth = auth.basic({ realm: 'Vimtur Media Manager' }, (username, password, callback) => {
        callback(username === exports.config.username && password === exports.config.password);
    });
    exports.authConnector = basicAuth;
}

exports.deleteMedia = (media) => {
    const hash = media.hash;
    FS.unlink(media.absolutePath, () => {
        console.log(`${media.absolutePath} removed`);
    });
    FS.unlink(`${exports.config.cachePath}/thumbnails/${hash}.png`, () => {
        console.log(`${exports.config.cachePath}/thumbnails/${hash}.png removed`);
    });
    RimRaf(`${exports.config.cachePath}/${hash}/`, () => {
        console.log(`${exports.config.cachePath}/${hash}/ removed`);
    });
};

exports.wrap = (func) => {
    return async(req, res) => {
        try {
            await func(req, res);
        } catch (err) {
            res.status(503).json({ error: err, message: err.message });
            console.log(req.params, req.query, err);
        }
    };
};
