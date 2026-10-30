#!/bin/sh -e

rm -rf ./dist/database/sqlite/migrations
cp -R ./src/database/sqlite/migrations ./dist/database/sqlite/migrations

rm -rf ./dist/tasks/autotag/assets
cp -R ./src/tasks/autotag/assets ./dist/tasks/autotag/assets

rm -rf ./dist/test/fixtures
cp -R ./src/test/fixtures ./dist/test/fixtures
