ARG PRE_IMAGE
FROM $PRE_IMAGE

RUN (cd /app/server && yarn --production --frozen-lockfile)
RUN apk del g++ make && rm -rf /app/.git
