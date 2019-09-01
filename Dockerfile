FROM node:10-alpine as build

## Copy in common
WORKDIR /common
COPY ./common ./

## Build server
WORKDIR /server
COPY ./server/package.json ./
RUN yarn --frozen-lockfile
COPY ./server ./
RUN yarn lint
RUN yarn build

# This strips out the dev dependencies.
RUN yarn install --production --frozen-lockfile

## Build client
WORKDIR /client
COPY ./client/package.json ./
RUN yarn --frozen-lockfile
COPY ./client ./
RUN yarn lint
RUN yarn build:prod
RUN yarn install --production --frozen-lockfile

FROM node:10-alpine

RUN apk add --no-cache tini graphicsmagick g++ make ffmpeg

WORKDIR /server
COPY --from=build /server/node_modules node_modules
COPY --from=build /server/dist dist
COPY --from=build /server/package.json .
COPY --from=build /server/export.sh .
COPY --from=build /server/import.sh .

WORKDIR /client
COPY --from=build /client/dist dist
COPY --from=build /client/node_modules node_modules

ENTRYPOINT [ "/sbin/tini", "--", "node", "/server/dist/index.js" ]
