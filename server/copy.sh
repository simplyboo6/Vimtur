#!/bin/sh -e

rm -rf ./dist/database/sqlite/migrations
cp -R ./src/database/sqlite/migrations ./dist/database/sqlite/migrations
