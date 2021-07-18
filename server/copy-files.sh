#!/bin/sh -e

if [ -d "./dist" ]; then
  find "./dist/" -name "*.sql" -exec rm {} \;
fi

find ./src -name "*.sql" -exec sh -ec 'mkdir -p $(dirname $(echo ${0} | sed s/src/dist/)) && cp ${0} $(echo ${0} | sed s/src/dist/)' {} \;
