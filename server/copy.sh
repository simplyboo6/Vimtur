#!/bin/sh -e

rm -rf ./dist/database/sqlite/migrations
cp -R ./src/database/sqlite/migrations ./dist/database/sqlite/migrations

rm -rf ./dist/tasks/autotag/mobilenet/assets
cp -R ./src/tasks/autotag/mobilenet/assets ./dist/tasks/autotag/mobilenet/assets

rm -rf ./dist/test/fixtures
cp -R ./src/test/fixtures ./dist/test/fixtures
