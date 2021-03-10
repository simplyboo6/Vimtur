ARG PRE_IMAGE
FROM $PRE_IMAGE as build

FROM simplyboo6/vimtur-base@sha256:f30cc178f6c9676449e08b0aee59e31c120eb5c467cb435c33fd2bedb230f593

COPY --from=build /app /app
WORKDIR /app
# Ignore scripts not to rebuild phash
RUN (cd /app/server && yarn --production --frozen-lockfile --ignore-scripts)
RUN apk del g++ make

ENTRYPOINT [ "/sbin/tini", "--", "node", "/app/server/dist/index.js" ]
