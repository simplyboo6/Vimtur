const auth = require('http-auth');
const walk = require('walk');
const path = require('path');
const md5File = require('md5-file');
const fs = require('fs');
const pathIsInside = require("path-is-inside");

exports.usage = function () {
    const prog = process.argv[0] + ' ' + process.argv[1];
    console.log("Usage: " + prog + " </path/to/config.json>");
};

const DefaultConfig = {
    "port": 3523
};

exports.config = DefaultConfig;

async function saveFile(file, data) {
    return new Promise(function(resolve, reject) {
        fs.writeFile(file, data, function(err) {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

try {
    if (process.argv.length < 1) {
        throw new Error('No parameters supplied');
    }
    const file = path.resolve(process.argv[process.argv.length - 1]);
    console.log(`Attempting to load ${file}`);
    if (!file.endsWith(".json")) {
        throw new Error('Specified file is not a config.json');
    }
    try {
        exports.config = require(file);
        console.log(`Config loaded from: ${file}`);
    } catch (err) {
        // Doesn't matter if it fails to load. Just means it's a new config.
    }
    exports.configPath = path.resolve(file);
} catch (err) {
    const configPath = path.resolve(path.dirname(require.main.filename), 'config.json');
    console.log(`Attempting to use default config config.json (${configPath})`);
    try {
        exports.config = require(configPath);
        console.log(`Config loaded from: ${configPath}`);
    } catch (err) {
        console.log("Failed to load ../config.json");
        console.log("Redirecting access to setup");
    }
    exports.configPath = configPath;
}

exports.isSetup = async function() {
    if (exports.configValid) {
        return true;
    }
    await exports.validateConfig();
    return true;
}

exports.saveConfig = async function(config) {
    await exports.validateConfig(config);
    exports.config = config;
    exports.configValid = false;
    await exports.validateConfig();
    await saveFile(exports.configPath, JSON.stringify(exports.config, null, 2));
    console.log(`Config file saved to ${exports.configPath}`);
};

async function exists(file) {
    return new Promise(function(resolve, reject) {
        fs.access(file, fs.constants.F_OK, (err) => {
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
    if (pathIsInside(path.resolve(config.cachePath), path.resolve(config.libraryPath))) {
        throw new Error('Cache folder cannot be inside the library');
    }
    if (!config.database) {
        throw new Error('No database provider defined');
    }
    switch (config.database.provider) {
        case 'mysql':
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
        case 'sqlite3':
            if (!(await exists(path.dirname(config.database.path)))) {
                throw new Error(`Database directory does not exist: ${path.dirname(config.database.path)}`);
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

exports.getAllInSameDir = function (image) {
    const output = [];
    const keys = global.db.getDefaultMap();
    for (let i = 0; i < keys.length; i++) {
        const dbImage = global.db.getMedia(keys[i]);
        if (dbImage.dir == image.dir) {
            output.push(dbImage.hash);
        }
    }
    return output;
};

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

function buildPathList(keys) {
    const list = [];
    for (let i = 0; i < keys.length; i++) {
        const image = global.db.getMedia(keys[i]);
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
                path: encodeURIComponent(path.relative(exports.config.libraryPath, mediaFile.absolutePath)),
                absolutePath: mediaFile.absolutePath,
                dir: path.dirname(mediaFile.absolutePath),
                rotation: 0,
                type: mediaFile.type,
                tags: [],
                hashDate: Math.floor(Date.now() / 1000)
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
    const map = global.db.getDefaultMap();
    console.log("Creating files list for library: " + exports.config.libraryPath);
    const returns = {
        newFiles: [],
        verifiedFiles: [],
        missing: []
    };
    const filesForMissing = [];
    const pathList = buildPathList(map);
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
        walker.on("end", function () {
            for (let i = 0; i < map.length; i++) {
                const image = global.db.getMedia(map[i]);
                if (filesForMissing[image.absolutePath] == undefined) {
                    returns.missing.push(image);
                }
            }
            resolve(returns);
        });
    });
};
