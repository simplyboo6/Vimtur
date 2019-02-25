const Auth = require('http-auth');
const FS = require('fs');
const RimRaf = require('rimraf');
const Config = require('./config');

exports.authConnector = (req, res, next) => {
    if (Config.get('username') && Config.get('password')) {
        const basicAuth = Auth.basic({ realm: 'Vimtur Media Manager' }, (username, password, callback) => {
            callback(username === Config.get('username') && password === Config.get('password'));
        });
        return Auth.connect(basicAuth)(req, res, next);
    }
    next();
};

// TODO this needs to be made async.
exports.deleteMedia = (media) => {
    const hash = media.hash;
    FS.unlink(media.absolutePath, () => {
        console.log(`${media.absolutePath} removed`);
    });
    FS.unlink(`${Config.get('cachePath')}/thumbnails/${hash}.png`, () => {
        console.log(`${Config.get('cachePath')}/thumbnails/${hash}.png removed`);
    });
    RimRaf(`${Config.get('cachePath')}/${hash}/`, () => {
        console.log(`${Config.get('cachePath')}/${hash}/ removed`);
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
