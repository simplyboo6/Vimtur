export PORT=8444
export DATABASE=sqlite
export CACHE_PATH=$(pwd)/data/cache
export DATA_PATH=$(pwd)/data/raw

mkdir -p "${CACHE_PATH}" "${DATA_PATH}"
