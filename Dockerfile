# Get the prebuilt binaries of the app
ARG PRE_IMAGE
FROM $PRE_IMAGE as build

# Build the resultant image.
FROM simplyboo6/vimtur-base@sha256:0256633d65dfead310f45d8d4b352c4e416d1a17889f0653eea6398c1bef161c

RUN apk add --no-cache jq

COPY --from=build /app /app

WORKDIR /app

# Yarn doesn't have prune
RUN (cd server/node_modules && rm -r $(cat ../package.json | jq -r '.devDependencies | keys | join(" ")'))

ENTRYPOINT [ "/sbin/tini", "--", "node", "/app/server/dist/index.js" ]
