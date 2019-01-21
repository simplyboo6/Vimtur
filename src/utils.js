const auth = require('http-auth');
const walk = require('walk');
const path = require('path');
const md5File = require('md5-file');
const FS = require('fs');
const RimRaf = require('rimraf');
const PathIsInside = require("path-is-inside");

exports.usage = function () {
    const prog = process.argv[0] + ' ' + process.argv[1];
    console.log("Usage: " + prog + " </path/to/config.json>");
};

exports.config = {
    "port": 3523
};

async function saveFile(file, data) {
    return new Promise(function(resolve, reject) {
        FS.writeFile(file, data, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

async function readFile(file) {
    return new Promise(function(resolve, reject) {
        FS.readFile(file, function(err, data) {
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
        console.log("Error parsing config JSON", err, data);
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
    mapEnv("CONFIG_PATH", exports, ["configPath"]);
    exports.configPath = process.env["CONFIG_PATH"];
    if (process.argv.length > 2) {
        exports.configPath = process.argv[process.argv.length - 1];
    }
    if (!exports.configPath && !process.env["CACHE_PATH"]) {
        console.log("Please specify either CONFIG_PATH, CACHE_PATH or a config on the command line")
        process.exit(0);
    }
    if (!exports.configPath) {
        exports.configPath = `${process.env["CACHE_PATH"]}/config.json`;
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
    mapEnv("PORT", exports, ["config", "port"]);
    mapEnv("DATA_PATH", exports, ["config", "libraryPath"]);
    mapEnv("CACHE_PATH", exports, ["config", "cachePath"]);
    mapEnv("USERNAME", exports, ["config", "username"]);
    mapEnv("PASSWORD", exports, ["config", "password"]);
    // Database mapping
    mapEnv("DATABASE", exports, ["config", "database", "provider"]);
    // MongoDB
    mapEnv("MONGO_HOST", exports, ["config", "database", "host"]);
    mapEnv("MONGO_DATABASE", exports, ["config", "database", "database"]);
    mapEnv("MONGO_USERNAME", exports, ["config", "database", "username"]);
    mapEnv("MONGO_PASSWORD", exports, ["config", "database", "password"]);
    mapEnv("MONGO_PORT", exports, ["config", "database", "port"]);

    await exports.validateConfig();
};

exports.isSetup = async function() {
    if (exports.configValid) {
        return true;
    }
    await exports.validateConfig();
    return true;
}

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
    return new Promise(function(resolve, reject) {
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
            if (!config.database.username) {
                throw new Error('Database username not defined');
            }
            if (!config.database.password) {
                throw new Error('Database password not defined');
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
}

if (exports.config.libraryPath) {
    console.log("Using library: " + exports.config.libraryPath);
} else {
    console.log("No library directory set");
}

if (exports.config.cachePath) {
    console.log("Using cache: " + exports.config.cachePath);
} else {
    console.log("No cache directory set");
}

exports.authConnector = function (req, res, next) {
    next();
};

if (exports.config.username != undefined && exports.config.password != undefined) {
    const basicAuth = auth.basic({ realm: "Vimtur Media Manager" }, function (username, password, callback) {
            callback(username === exports.config.username && password === exports.config.password);
    });
    exports.authConnector = basicAuth;
}

exports.findImageNumberInSet = function (keys, image) {
    for (let i = 0; i < keys.length; i++) {
        if (keys[i] == image.hash) {
            return i;
        }
    }
    return 0;
};

exports.slimScannerStatus = function (scannerStatus, includeExtra = false) {
    const status = {
        time: scannerStatus.time,
        missing: scannerStatus.missing
    };
    if (scannerStatus.newFiles != undefined) {
        status.numNew = scannerStatus.newFiles.length;
    }
    if (scannerStatus.verifiedFiles != undefined) {
        status.numVerified = scannerStatus.verifiedFiles.length;
    }
    if (includeExtra) {
        status.newFiles = scannerStatus.newFiles;
    }
    return status;
};

exports.shuffle = function (array) {
    let currentIndex = array.length, temporaryValue, randomIndex;

    // While there remain elements to shuffle...
    while (0 !== currentIndex) {
        // Pick a remaining element...
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex -= 1;

        // And swap it with the current element.
        temporaryValue = array[currentIndex];
        array[currentIndex] = array[randomIndex];
        array[randomIndex] = temporaryValue;
    }

    return array;
};

function getExtension(filename) {
    const ext = path.extname(filename || '').split('.');
    return ext[ext.length - 1].toLowerCase();
}

async function buildPathList(keys) {
    const list = [];
    for (let i = 0; i < keys.length; i++) {
        const image = await global.db.getMedia(keys[i]);
        list[image.absolutePath] = image;
    }
    return list;
}

exports.generateMediaFromFile = async function (mediaFile) {
    return new Promise(function(resolve, reject) {
        md5File(mediaFile.absolutePath, function (err, hash) {
            if (err) {
                reject(err);
                return;
            }
            const image = {
                hash: hash,
                path: path.relative(exports.config.libraryPath, mediaFile.absolutePath),
                absolutePath: mediaFile.absolutePath,
                dir: path.dirname(path.relative(exports.config.libraryPath, mediaFile.absolutePath)),
                rotation: 0,
                type: mediaFile.type,
                tags: [],
                actors: [],
                hashDate: Math.floor(Date.now() / 1000),
                cached: false,
                corrupted: false,
            };
            resolve(image);
        });
    });
};

exports.generateMediaFromFiles = async function (fileList, status) {
    const mediaList = [];
    for (let i = 0; i < fileList.length; i++) {
        console.log("Generating data for: " + fileList[i].absolutePath);
        const media = await exports.generateMediaFromFile(fileList[i]);
        mediaList.push(media);
        if (status) {
            status(i, media);
        }
    }
    return mediaList;
};

exports.scan = async function() {
    const map = await global.db.subset();
    console.log("Creating files list for library: " + exports.config.libraryPath);
    const returns = {
        newFiles: [],
        verifiedFiles: [],
        missing: []
    };
    const filesForMissing = [];
    const pathList = await buildPathList(map);
    const options = {
        followLinks: false
    };
    const walker = walk.walk(exports.config.libraryPath, options);

    walker.on("file", function (root, fileStats, next) {
        switch (getExtension(fileStats.name)) {
            case "png":
            case "jpg":
            case "jpeg":
            case "bmp":
                fileStats.type = "still";
                break;
            case "gif":
                fileStats.type = "gif";
                break;
            case "avi":
            case "mp4":
            case "flv":
            case "wmv":
            case "mov":
            case "webm":
            case "mpeg":
            case "mpg":
                fileStats.type = "video";
                break;
            default:
                fileStats.type = null;
                break;
        }

        if (fileStats.type != null) {
            fileStats.absolutePath = path.resolve(root, fileStats.name);
            fileStats.root = path.dirname(fileStats.absolutePath);
            const existingImage = pathList[fileStats.absolutePath];
            if (existingImage == undefined || existingImage == null) {
                returns.newFiles.push(fileStats);
            } else {
                fileStats.image = existingImage;
                returns.verifiedFiles.push(fileStats);
            }
            filesForMissing[fileStats.absolutePath] = fileStats;
        }
        next();
    });

    return new Promise(function(resolve, reject) {
        walker.on("end", async function () {
            for (let i = 0; i < map.length; i++) {
                const image = await global.db.getMedia(map[i]);
                if (filesForMissing[image.absolutePath] == undefined) {
                    returns.missing.push(image);
                }
            }
            resolve(returns);
        });
    });
};

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
