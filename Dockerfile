FROM simplyboo6/vimtur-base@sha256:f30cc178f6c9676449e08b0aee59e31c120eb5c467cb435c33fd2bedb230f593
ARG PRE_IMAGE

COPY --from=$PRE_IMAGE /app /app
WORKDIR /app
RUN (cd /app/server && yarn --production --frozen-lockfile)
RUN apk del g++ make

ENTRYPOINT [ "/sbin/tini", "--", "node", "/app/server/dist/index.js" ]
