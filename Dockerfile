FROM simplyboo6/vimtur-base@sha256:ac677907ec133d515b11cb575ab8b77da056978fae8646e38191828f0c0d1880 as build

ARG VERSION_NAME=dev

RUN apk add -U g++ make python3

## Copy in source
COPY ./ /app/
RUN echo "$VERSION_NAME" > /app/version

## Build server
RUN cd /app/server && \
    yarn link phash2 && \
    yarn --frozen-lockfile && \
    yarn lint && yarn build

## Build client
RUN cd /app/client && \
    yarn --frozen-lockfile && \
    yarn lint && yarn build:prod && \
    rm -rf node_modules

WORKDIR /app

ENTRYPOINT [ "/sbin/tini", "--", "node", "/app/server/dist/index.js" ]

# Build the resultant image.
FROM simplyboo6/vimtur-base@sha256:ac677907ec133d515b11cb575ab8b77da056978fae8646e38191828f0c0d1880

RUN apk add --no-cache jq

COPY --from=build /app/client/dist /app/client/dist
COPY --from=build /app/server /app/server
COPY --from=build /app/common /app/common

WORKDIR /app

# Yarn doesn't have prune
RUN (cd server/node_modules && rm -r $(cat ../package.json | jq -r '.devDependencies | keys | join(" ")'))

ENTRYPOINT [ "/sbin/tini", "--", "node", "/app/server/dist/index.js" ]
