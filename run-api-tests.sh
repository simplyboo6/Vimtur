#!/bin/sh

# API stability tests: boots the compiled server as a subprocess against an
# in-memory SQLite database and exercises it purely over HTTP. No Docker or
# MongoDB required. For the internal/database test suite use run-tests.sh.

set -e
cd "$(dirname "$0")/server"

echo "Building server..."
yarn build

echo "Running API tests..."
yarn test:api
