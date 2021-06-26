# Get the prebuilt binaries of the app
ARG PRE_IMAGE
FROM $PRE_IMAGE as build

# Build the resultant image.
FROM simplyboo6/vimtur-base@sha256:56ca5d1026ee49d7f197fe735f6817ba8a7687fde1b7c37239bc687046142597

RUN apk add --no-cache jq

COPY --from=build /app /app

WORKDIR /app

# Yarn doesn't have prune
RUN (cd server/node_modules && rm -r $(cat ../package.json | jq -r '.devDependencies | keys | join(" ")'))

ENTRYPOINT [ "/sbin/tini", "--", "node", "/app/server/dist/index.js" ]
