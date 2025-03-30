FROM node:22-alpine3.21 as build

ARG VERSION_NAME=dev

# python3, g++, make required for tensowflowjs build
RUN corepack enable && apk add -U python3 g++ make && mkdir -p /app/server /app/client

# Copy in files necessary to install node_modules first so this layer can be cached
COPY ./common /app/common
COPY ./server/package.json ./server/yarn.lock ./server/.yarnrc.yml /app/server/
COPY ./client/package.json ./client/yarn.lock ./client/.yarnrc.yml /app/client/

RUN cd /app/server && yarn link --relative ../common && yarn --immutable && \
    cd /app/client && yarn link --relative ../common && yarn --immutable

## Copy in source
COPY ./ /app/

## Build
RUN cd /app/server && yarn lint && yarn build && \
    cd /app/client && yarn lint && yarn build:prod

RUN echo "$VERSION_NAME" > /app/version

# Build the resultant image.
FROM node:22-alpine3.21

RUN apk add --no-cache tini imagemagick ffmpeg pngquant jq gallery-dl yt-dlp sqlite

RUN yt-dlp --version && gallery-dl --version && ffmpeg -version && ffprobe -version && pngquant --version

COPY --from=build /app/client/dist /app/client/dist
COPY --from=build /app/server /app/server
COPY --from=build /app/common /app/common

WORKDIR /app

# Yarn doesn't have prune
RUN (cd server/node_modules && rm -r $(cat ../package.json | jq -r '.devDependencies | keys | join(" ")'))

ENTRYPOINT [ "/sbin/tini", "--", "node", "/app/server/dist/index.js" ]
