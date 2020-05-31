#!/bin/sh

set -e

echo "Starting Mongo instance..."
docker run -d --name mongo_test --tmpfs /data/db -p 127.0.0.1:27020:27017/tcp mongo:4.2
cd server

echo "Running tests..."

mkdir -p /tmp/cache /tmp/data

export DATABASE="mongodb"
export DATABASE_URI="mongodb://localhost:27020"
export DATABASE_DB="test"
export DATA_PATH="/tmp/data"
export CACHE_PATH="/tmp/cache"
export SCHEMA_PATH="./dist/schemas"

set +e
yarn test
TEST_RESULT=$?

set -e

echo "Stopping Mongo instance..."
docker kill mongo_test
docker rm mongo_test

if [ ${TEST_RESULT} == "0" ]; then
  echo "Tests passed"
else
  echo "Tests failed"
fi

exit ${TEST_RESULT}
