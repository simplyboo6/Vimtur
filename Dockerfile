# Get the prebuilt binaries of the app
ARG PRE_IMAGE
FROM $PRE_IMAGE as build

# Get the base image with phash in.
FROM simplyboo6/vimtur-base@sha256:f30cc178f6c9676449e08b0aee59e31c120eb5c467cb435c33fd2bedb230f593 as base

# Build the resultant image.
FROM alpine:20200122

RUN apk add --no-cache tini imagemagick jpeg libpng tiff libx11 ffmpeg nodejs yarn

COPY --from=base /usr/local/lib/libpHash.so.1.0.0 /usr/local/lib/libpHash.so /usr/local/lib/
COPY --from=base /usr/lib/node_modules /usr/lib/node_modules

COPY --from=build /app /app
WORKDIR /app

# Ignore scripts not to rebuild phash
RUN (cd /app/server && yarn --production --frozen-lockfile --ignore-scripts)

ENTRYPOINT [ "/sbin/tini", "--", "node", "/app/server/dist/index.js" ]
