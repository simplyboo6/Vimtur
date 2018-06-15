async function setup(config) {
    const db = require(`./${config.database.provider}`);
    return await db.setup(config);
}

module.exports = {
    setup
};
