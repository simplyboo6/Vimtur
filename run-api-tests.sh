#!/bin/sh

# API stability tests: boots the compiled server as a subprocess against an
# in-memory SQLite database and exercises it purely over HTTP. No Docker or
# MongoDB required. For the internal/database test suite use run-tests.sh.

set -e
cd "$(dirname "$0")/server"

# Task loaders are discovered per moved directory, so a stale dist/ left over
# from before a module move would double-register the same task ids. The schema
# hash cache has to go with it or create-schemas.sh skips the now-missing schemas.
rm -rf dist .schema-build-info

echo "Building server..."
yarn build

echo "Running API tests..."
yarn test:api
