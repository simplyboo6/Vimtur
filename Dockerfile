# Get the prebuilt binaries of the app
ARG PRE_IMAGE
FROM $PRE_IMAGE as build

# Get the base image with phash in.
FROM simplyboo6/vimtur-base@sha256:f30cc178f6c9676449e08b0aee59e31c120eb5c467cb435c33fd2bedb230f593 as base

# Build the resultant image.
FROM alpine:20200122

RUN apk add --no-cache tini imagemagick jpeg libpng tiff libx11 ffmpeg nodejs yarn jq

COPY --from=base /usr/local/lib/libpHash.so.1.0.0 /usr/local/lib/libpHash.so /usr/local/lib/

COPY --from=build /app /app
WORKDIR /app

# Yarn doesn't have prune
RUN (cd server/node_modules && rm -r $(cat ../package.json | jq -r '.devDependencies | keys | join(" ")'))

ENTRYPOINT [ "/sbin/tini", "--", "node", "/app/server/dist/index.js" ]
