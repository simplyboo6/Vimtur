# Get the prebuilt binaries of the app
ARG PRE_IMAGE
FROM $PRE_IMAGE as build

# Build the resultant image.
FROM simplyboo6/vimtur-base@sha256:b3576d012e192fa39b97f0f5845cda875cef94d64a39dc97747fa32d035e14bd

RUN apk add --no-cache jq

COPY --from=build /app /app

WORKDIR /app

# Yarn doesn't have prune
RUN (cd server/node_modules && rm -r $(cat ../package.json | jq -r '.devDependencies | keys | join(" ")'))

ENTRYPOINT [ "/sbin/tini", "--", "node", "/app/server/dist/index.js" ]
