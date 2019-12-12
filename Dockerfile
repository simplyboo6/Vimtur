FROM alpine:20191114 as build

## Compile pHash
RUN apk add -U git jpeg-dev libpng-dev libsndfile-dev libsamplerate-dev tiff-dev g++ make cmake libx11-dev python3 ffmpeg-dev nodejs yarn
WORKDIR /build
RUN git clone https://github.com/aetilius/pHash.git
RUN git -C pHash checkout 887d07b9bdd9e2fb082c932002cefbcb1c8c20a1
# Build fix on Alpine
RUN sed 's|#include <sys/sysctl.h>||g' ./pHash/src/pHash.h.cmake > ./pHash/src/pHash.h.cmake.tmp && mv ./pHash/src/pHash.h.cmake.tmp ./pHash/src/pHash.h.cmake

WORKDIR /build/build
RUN cmake -DWITH_AUDIO_HASH=ON -DWITH_VIDEO_HASH=ON /build/pHash
RUN make -j8
RUN make install
RUN cp /build/pHash/third-party/CImg/CImg.h /usr/include/

## Copy in common
WORKDIR /common
COPY ./common ./

## Build server
WORKDIR /server
COPY ./server/package.json ./server/yarn.lock ./
RUN yarn --frozen-lockfile
COPY ./server ./
RUN yarn lint
RUN yarn build

# This strips out the dev dependencies.
RUN yarn install --production --frozen-lockfile

## Build client
WORKDIR /client
COPY ./client/package.json ./client/yarn.lock ./
RUN yarn --frozen-lockfile
COPY ./client ./
RUN yarn lint
RUN yarn build:prod
RUN yarn install --production --frozen-lockfile

FROM alpine:20191114

RUN apk add --no-cache tini graphicsmagick imagemagick g++ make jpeg libpng libsndfile libsamplerate tiff libx11 python3 ffmpeg nodejs yarn

COPY --from=build /usr/local/lib/libpHash.so.1.0.0 /usr/local/lib/libpHash.so.1.0.0
COPY --from=build /usr/local/lib/libpHash.so /usr/local/lib/libpHash.so
COPY --from=build /usr/local/include/pHash.h /usr/local/include/pHash.h
COPY --from=build /usr/include/CImg.h /usr/include/CImg.h

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
