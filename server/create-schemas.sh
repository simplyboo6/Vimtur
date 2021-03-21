#!/bin/sh

set -e

COMMON_TYPES="./node_modules/@vimtur/common/src"
SCHEMA_HASHES="./.schema-build-info"
OUT_DIR="./dist/schemas"

mkdir -p ${OUT_DIR} ${SCHEMA_HASHES} ${ARCHIVE_DIR}

gen_schema() {
    TYPE_NAME=${1}
    WATCH_LIST=${2}

    HASH_FILENAME="${SCHEMA_HASHES}/${TYPE_NAME}"

    set +e
    sha1sum -c ${HASH_FILENAME} > /dev/null 2>&1
    NEEDS_REBUILD=$?
    set -e

    if [ "${NEEDS_REBUILD}" != "0" ]; then
        echo "Rebuilding ${TYPE_NAME}..."
        ./node_modules/.bin/typescript-json-schema ./tsconfig.json --strictNullChecks --required --refs false --noExtraProps ${TYPE_NAME} -o ${OUT_DIR}/${TYPE_NAME}.json
        sha1sum ${WATCH_LIST} > ${HASH_FILENAME}
        echo "Rebuilt ${TYPE_NAME}"
    fi
}

gen_schema "Configuration.Main" "${COMMON_TYPES}/config.d.ts"
gen_schema "UpdateMedia" "${COMMON_TYPES}/media.d.ts"
gen_schema "SubsetConstraints" "${COMMON_TYPES}/search.d.ts"
gen_schema "BulkUpdate" "${COMMON_TYPES}/bulk.d.ts ${COMMON_TYPES}/media.d.ts ${COMMON_TYPES}/search.d.ts"
gen_schema "MediaResolution" "${COMMON_TYPES}/media.d.ts"
gen_schema "BaseMedia" "${COMMON_TYPES}/media.d.ts"

# Playlists
gen_schema "PlaylistCreate" "${COMMON_TYPES}/playlist.d.ts"
gen_schema "PlaylistUpdate" "${COMMON_TYPES}/playlist.d.ts"
gen_schema "PlaylistEntryUpdate" "${COMMON_TYPES}/playlist.d.ts"
