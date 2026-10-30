FROM node:24-slim AS build

ARG VERSION_NAME=dev

RUN corepack enable && mkdir -p /app/server /app/client

# Copy in files necessary to install node_modules first so this layer can be cached
COPY ./common /app/common
COPY ./server/package.json ./server/yarn.lock ./server/.yarnrc.yml /app/server/
COPY ./client/package.json ./client/yarn.lock ./client/.yarnrc.yml /app/client/

# Skip the onnxruntime-node postinstall that downloads the CUDA provider
# (~271MB of dead weight on GPU-less hosts). The CPU EP ships inside the
# npm tarball, so CPU inference is unaffected.
ENV ONNXRUNTIME_NODE_INSTALL=skip

RUN cd /app/server && yarn link --relative ../common && yarn --immutable && \
    cd /app/client && yarn link --relative ../common && yarn --immutable

## Copy in source
COPY ./ /app/

## Build
RUN cd /app/server && yarn lint && yarn build && \
    cd /app/client && yarn lint && yarn build:prod

RUN echo "$VERSION_NAME" > /app/version

# Build the resultant image. Debian-based (glibc) because onnxruntime-node
# ships prebuilt bindings linked against glibc; Alpine/musl is unsupported.
FROM node:24-slim AS runtime

# The downloader CLIs update frequently and are not packaged; they install
# into their own venv to keep the system Python clean and reproducible.
# yt-dlp wants an external JS runtime for some extractors (e.g. YouTube);
# without one those hosts will not work.
RUN apt-get update && apt-get install -y --no-install-recommends \
    tini imagemagick ffmpeg pngquant jq sqlite3 python3-minimal python3-venv && \
    python3 -m venv /opt/pip-venv && \
    /opt/pip-venv/bin/pip install --no-cache-dir yt-dlp gallery-dl && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
ENV PATH=/opt/pip-venv/bin:$PATH

RUN yt-dlp --version && gallery-dl --version && ffmpeg -version && ffprobe -version && pngquant --version

COPY --from=build /app/version /app/version
COPY --from=build /app/client/dist /app/client/dist
COPY --from=build /app/server /app/server
COPY --from=build /app/common /app/common

WORKDIR /app

# Yarn doesn't have prune
RUN (cd server/node_modules && rm -r $(cat ../package.json | jq -r '.devDependencies | keys | join(" ")'))

ENTRYPOINT [ "/usr/bin/tini", "--", "node", "/app/server/dist/index.js" ]
