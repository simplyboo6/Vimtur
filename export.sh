#!/bin/sh

if [ -z ${1} ]; then
    echo "The first argument should be the filename to export to"
    exit 1
fi

echo "Exporting to ${1}..."
docker-compose exec vimtur /bin/sh -c 'rm -f /tmp/output.json && node /src/dist/utils/export-json.js -f /tmp/output.json'
docker-compose exec vimtur /bin/sh -c 'cat /tmp/output.json' > ${1}
