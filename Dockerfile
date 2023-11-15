FROM alpine:3.18 as build

ARG VERSION_NAME=dev

RUN apk add -U g++ make nodejs yarn gallery-dl yt-dlp npm && npm install -g node-gyp

## Copy in source
COPY ./ /app/
RUN echo "$VERSION_NAME" > /app/version

## Build server
RUN cd /app/server && \
    yarn --frozen-lockfile && \
    yarn lint && yarn build

## Build client
RUN cd /app/client && \
    yarn --frozen-lockfile && \
    yarn lint && yarn build:prod && \
    rm -rf node_modules

# Build the resultant image.
FROM alpine:3.18

RUN apk add --no-cache tini imagemagick ffmpeg nodejs pngquant jq gallery-dl yt-dlp

RUN yt-dlp --version && gallery-dl --version && ffmpeg -version && ffprobe -version && pngquant --version

COPY --from=build /app/client/dist /app/client/dist
COPY --from=build /app/server /app/server
COPY --from=build /app/common /app/common

WORKDIR /app

# Yarn doesn't have prune
RUN (cd server/node_modules && rm -r $(cat ../package.json | jq -r '.devDependencies | keys | join(" ")'))

ENTRYPOINT [ "/sbin/tini", "--", "node", "/app/server/dist/index.js" ]
