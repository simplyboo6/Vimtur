export PORT=8444
export DATABASE=mongodb
export DATABASE_URI=mongodb://root:root@localhost:27017
export DATABASE_DB=vimtur
export CACHE_PATH=$(pwd)/data/cache
export DATA_PATH=$(pwd)/data/raw

mkdir -p "${CACHE_PATH}" "${DATA_PATH}"
