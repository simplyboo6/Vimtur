#!/bin/sh

if [ -z ${1} ]; then
    echo "The first argument should be the filename to import from"
    exit 1
fi

echo "Importing ${1}..."
cat ${1} | docker exec -i $(docker-compose ps -q vimtur) /bin/sh -c 'node /opt/app/src/utils/import-json.js --stdin'
