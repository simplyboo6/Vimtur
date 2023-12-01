#!/bin/sh -e

docker run -v /data/db --restart unless-stopped -e MONGO_INITDB_ROOT_USERNAME=root -e MONGO_INITDB_ROOT_PASSWORD=root -p 27017:27017 -d mongo:4
