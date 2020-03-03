FROM alpine:20200122 as build

## Compile pHash
RUN apk add -U git jpeg-dev libpng-dev tiff-dev g++ make cmake libx11-dev python3 nodejs yarn
WORKDIR /build
RUN git clone https://github.com/aetilius/pHash.git && \
    git -C pHash checkout 887d07b9bdd9e2fb082c932002cefbcb1c8c20a1 && \
    sed 's|#include <sys/sysctl.h>||g' ./pHash/src/pHash.h.cmake > ./pHash/src/pHash.h.cmake.tmp && mv ./pHash/src/pHash.h.cmake.tmp ./pHash/src/pHash.h.cmake && \
    mkdir -p /build/pHash/build && cd /build/pHash/build && \
    cmake -DWITH_AUDIO_HASH=OFF -DWITH_VIDEO_HASH=OFF /build/pHash && \
    make -j8 && make install && \
    cp /build/pHash/third-party/CImg/CImg.h /usr/include/

## Copy in source
COPY ./ /build/

## Build server
RUN cd /build/server && \
    yarn --frozen-lockfile --network-timeout 1000000 && \
    yarn lint && yarn build && \
    yarn install --production --frozen-lockfile --network-timeout 1000000

## Build client
RUN cd /build/client && \
    yarn --frozen-lockfile --network-timeout 1000000 && \
    yarn lint && yarn build:prod && \
    yarn install --production --frozen-lockfile --network-timeout 1000000

FROM alpine:20200122

RUN apk add --no-cache tini graphicsmagick imagemagick g++ make jpeg libpng libsndfile libsamplerate tiff libx11 python3 ffmpeg nodejs

COPY --from=build /usr/local/lib/libpHash.so.1.0.0 /usr/local/lib/libpHash.so /usr/local/lib/
COPY --from=build /usr/local/include/pHash.h /usr/local/include/pHash.h
COPY --from=build /usr/include/CImg.h /usr/include/CImg.h

WORKDIR /app
COPY --from=build /build/server /app/server
COPY --from=build /build/client /app/client

ENTRYPOINT [ "/sbin/tini", "--", "node", "/app/server/dist/index.js" ]
