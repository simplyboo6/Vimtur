ARG PRE_IMAGE
FROM $PRE_IMAGE

RUN (cd /app/server && yarn --production --frozen-lockfile)
RUN (cd /app/client && yarn --production --frozen-lockfile)
