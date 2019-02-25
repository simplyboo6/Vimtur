const Config = require('../config');

async function setup() {
    const db = require(`./${Config.get('database.provider')}`);
    return await db.setup(Config.get());
}

module.exports = {
    setup
};
