const mysql = require('mysql');
const path = require('path');
const fs = require('fs');
const ExpressionParser = require('../expression');
const Search = require('../search');
const MediaManager = require('../manager.js');

class MySQLDatabase extends MediaManager {
    constructor(config) {
        super(config);
        this.db = null;
    }

    async loadDefaultSql() {
        return new Promise((resolve, reject) => {
            fs.readFile(path.resolve(path.dirname(__filename), 'database.sql'), 'utf8', function (err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });
    }

    async each(query, callback, values) {
        return new Promise((resolve, reject) => {
            try {
                const result = this.db.query(query, values);
                result.on('error', function(err) {
                    reject(err);
                });
                result.on('result', function(row) {
                    callback(row);
                });
                result.on('end', resolve);
            } catch(err) {
                reject(err)
            }
        });
    }

    async query(query, values) {
        return new Promise((resolve, reject) => {
            try {
                this.db.query(query, values, function (error, results, fields) {
                    if (error) {
                        reject(new Error(`Error running query: ${query} - ${JSON.stringify(values)}: ${error}`));
                    } else {
                        resolve(results);
                    }
                });
            } catch(err) {
                reject(err)
            }
        });
    }

    async getVersion() {
        const row = await this.query('SELECT * FROM version ORDER BY version DESC LIMIT 1');
        return row.version;
    }

    async setVersion(version) {
        await this.query('INSERT INTO version(version) VALUES (?)', [version]);
    }

    async close() {
        const $this = this;
        return new Promise((resolve, reject) => {
            if ($this.rebuildTimeout) {
                clearTimeout($this.rebuildTimeout);
                $this.rebuildTimeout = null;
            }
            $this.db.end(function (err) {
                resolve();
            });
        });
    }

    saveMediaRow(row) {
        super.addMedia(row.hash, row.path, row.rotation, row.type, row.hash_date);
        const additional = {
            metadata: row.cached ? {
                width: row.width,
                height: row.height,
                length: row.length,
                artist: row.artist,
                album: row.album,
                title: row.title
            } : undefined,
            transcode: !!row.priority_transcode,
            corrupted: !!row.corrupted,
            rating: row.rating ? row.rating : 0
        };
        super.updateMedia(row.hash, additional);
    }

    async addCollection(name) {
        const results = await this.query('INSERT IGNORE INTO collections (name) VALUES (?)', [name]);
        if (super.addCollection(results.insertId, name)) {
            return global.db.getCollection(results.insertId);
        } else {
            return null;
        }
    }

    async removeCollection(id) {
        if (super.removeCollection(id)) {
            await this.query('DELETE FROM collection_data WHERE id=?', [id]);
            await this.query('DELETE FROM collections WHERE id=?', [id]);
        }
    }

    async addMediaToCollection(id, hash) {
        if (super.addMediaToCollection(id, hash)) {
            await this.query('INSERT IGNORE INTO collection_data (id, hash) VALUES (?, ?)', [id, hash]);
        }
    }

    async removeMediaFromCollection(id, hash) {
        if (super.removeMediaFromCollection(id, hash)) {
            await this.query('DELETE FROM collection_data WHERE id=? AND hash=?', [id, hash]);
        }
    }

    async load() {
        const $this = this;
        console.log("Loading tags.");
        const tags = await this.query("SELECT * FROM tags");
        if (tags) {
            for (let i = 0; i < tags.length; i++) {
                const row = tags[i];
                if (row.tag.length > 0) {
                    super.addTag(row.tag);
                }
            }
        }

        console.log(`Tags loaded (${this.tags.length}). Loading media.`);
        console.time('Loading media');
        await this.each(`
            SELECT
                images.*,
                IF(corrupted.hash IS NULL, FALSE, TRUE) AS corrupted,
                IF(priority_transcode.hash IS NULL, FALSE, TRUE) AS priority_transcode,
                IF(cached.hash IS NULL, FALSE, TRUE) AS cached,
                cached.*,
                ratings.rating
                from images
                LEFT JOIN corrupted ON (corrupted.hash = images.hash)
                LEFT JOIN priority_transcode ON (priority_transcode.hash = images.hash)
                LEFT JOIN cached ON (cached.hash = images.hash)
                LEFT JOIN ratings ON (ratings.hash = images.hash) ORDER BY path`,
            function (row) {
                $this.saveMediaRow(row);
            });
        console.timeEnd('Loading media');
        console.log(`Media loaded (${Object.keys(this.media).length}). Loading media tags.`);

        console.time('Loading media tags');
        const mediaTags = await this.query("SELECT * FROM imgtags");
        if (mediaTags) {
            for (let i = 0; i < mediaTags.length; i++) {
                const row = mediaTags[i];
                super.addTag(row.tag, row.hash);
            }
        }
        console.timeEnd('Loading media tags');

        console.log('Loading collections');
        console.time('Loading collections');
        const collections = await this.query('SELECT * FROM collections');
        if (collections) {
            for (let i = 0; i < collections.length; i++) {
                const row = collections[i];
                super.addCollection(parseInt(row.id), row.name);
            }
        }
        const collectionData = await this.query('SELECT * FROM collection_data');
        if (collectionData) {
            for (let i = 0; i < collectionData.length; i++) {
                const row = collectionData[i];
                $this.addMediaToCollection(parseInt(row.id), row.hash);
            }
        }
        console.timeEnd('Loading collections');
    }

    async updateMedia(hash, args) {
        if (super.updateMedia(hash, args)) {
            const media = this.media[hash];
            if (args.path !== undefined) {
                await this.query('UPDATE images SET path=? WHERE hash=?', [media.path, media.hash]);
            }
            if (args.rotation !== undefined) {
                await this.query('UPDATE images SET rotation=? WHERE hash=?', [media.rotation, media.hash]);
            }
            if (args.type !== undefined) {
                await this.query('UPDATE images SET type=? WHERE hash=?', [media.type, media.hash]);
            }
            if (args.hashDate !== undefined) {
                await this.query('UPDATE images SET hash_date=? WHERE hash=?', [media.hashDate, media.hash]);
            }
            if (args.rating !== undefined) {
                await this.query('INERT IGNORE INTO ratings (hash, rating) VALUES (?, ?) ON DUPLICATE KEY UPDATE rating=?', [media.hash, media.rating, media.rating]);
            }
            if (args.metadata) {
                await this.query("INSERT INTO cached (hash, width, height, length, artist, album, title) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE artist=?, album=?, title=?",
                          [media.hash, media.metadata.width, media.metadata.height, media.metadata.length, media.metadata.artist, media.metadata.album,
                           media.metadata.title, media.metadata.artist, media.metadata.album, media.metadata.title]);
            }
            if (args.corrupted !== undefined) {
                if (args.corrupted) {
                    await this.query("INSERT IGNORE INTO corrupted (hash) VALUES (?)", [media.hash]);
                } else {
                    await this.query("DELETE FROM corrupted WHERE hash=?", [media.hash]);
                }
            }
            if (args.transcode !== undefined) {
                if (args.transcode) {
                    await this.query("INSERT IGNORE INTO priority_transcode (hash) VALUES (?)", [media.hash]);
                } else {
                    await this.query("DELETE FROM priority_transcode WHERE hash=?", [media.hash]);
                }
            }
            return true;
        } else if (super.addMedia(args.hash, args.path, 0, args.type, args.hashDate)) {
            const media = this.media[hash];
            await this.query('INSERT INTO images (hash, path, type, hash_date) VALUES (?, ?, ?, ?)', [media.hash, media.path, media.type, media.hashDate]);
            return true;
        }
        return false;
    }

    async removeMedia(media) {
        if (super.removeMedia(media)) {
            await this.query('INSERT IGNORE INTO deleted (hash, time) VALUES (?, ?)', [media.hash, Math.floor(Date.now() / 1000)]);
            await this.query('DELETE FROM imgtags WHERE hash=?', [media.hash]);
            await this.query("DELETE FROM cached WHERE hash=?", [media.hash]);
            await this.query("DELETE FROM priority_transcode WHERE hash=?", [media.hash]);
            await this.query("DELETE FROM corrupted WHERE hash=?", [media.hash]);
            await this.query("DELETE FROM collection_data WHERE hash=?", [media.hash]);
            await this.query('DELETE FROM images WHERE hash=?', [media.hash]);
            return true;
        }
        return false;
    }

    async addTag(tag, hash) {
        if (super.addTag(tag, hash)) {
            if (hash) {
                await this.query('INSERT IGNORE INTO imgtags VALUES(?, ?)', [hash, tag]);
            } else {
                await this.query('INSERT IGNORE INTO tags VALUES(?)', [tag]);
            }
            return true;
        }
        return false;
    }

    async removeTag(tag, hash) {
        if (super.removeTag(tag, hash)) {
            if (hash) {
                await this.query('DELETE FROM imgtags WHERE hash=? AND tag=?', [hash, tag]);
            } else {
                await this.query('DELETE FROM imgtagss WHERE tag=?', [tag]);
                await this.query('DELETE FROM tags WHERE tag=?', [tag]);
            }
            return true;
        }
        return false;
    }

    async connect(host, username, password, database) {
        const $this = this;
        return new Promise((resolve, reject) => {
            try {
                function connect(callback) {
                    const local_db = mysql.createConnection({
                        host: host,
                        user: username,
                        password: password,
                        database: database,
                        multipleStatements: true,
                        charset: "utf8mb4_general_ci"
                    });

                    local_db.on('error', function (err) {
                        console.log("MySQL DB Error", err);
                        if (err.code == 'PROTOCOL_CONNECTION_LOST') {
                            connect();
                        }
                    });

                    local_db.connect(function(err) {
                        if (err) {
                            console.log("Failed to connect to MySQL server, retrying in 10 seconds.");
                            setTimeout(function() { connect(callback) }, 10000);
                        } else {
                            console.log("Connected to MySQL server.");
                            if (callback) {
                                callback();
                            }
                            $this.db = local_db;
                        }
                    });
                }

                connect(resolve);
            } catch(err) {
                reject(err);
            }
        });
    }
}

async function setup(config) {
    const db = new MySQLDatabase(config);
    await db.connect(config.database.host, config.database.username, config.database.password, config.database.database);
    console.log(`Using database: mysql://${config.database.username}@${config.database.host}/${config.database.database}`);
    console.log("MySQL database connected.");
    const setupQuery = await db.loadDefaultSql();
    await db.query(setupQuery);
    const version = await db.getVersion();
    switch(version) {
        default: break
    }
    console.time('Database load took');
    await db.load();
    await db.setup();
    console.timeEnd('Database load took');

    return db;
}

module.exports = {
    setup
};
