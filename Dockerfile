FROM node:10-alpine as build

WORKDIR /src

COPY ./package.json /src
RUN yarn --frozen-lockfile

COPY . /src
RUN yarn lint
#RUN yarn lint-web
RUN yarn build

# This strips out the dev dependencies.
RUN yarn install --production --frozen-lockfile

FROM node:10-alpine

RUN apk add --no-cache tini graphicsmagick g++ make ffmpeg

WORKDIR /src
COPY --from=build /src/node_modules node_modules
COPY --from=build /src/dist dist
COPY --from=build /src/web web
COPY --from=build /src/package.json .
COPY --from=build /src/export.sh .
COPY --from=build /src/import.sh .

ENTRYPOINT [ "/sbin/tini", "--", "node", "dist/index.js" ]
