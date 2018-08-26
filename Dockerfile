FROM alpine:3.7
RUN apk update
RUN apk add nodejs graphicsmagick g++ make ffmpeg
ADD . /opt/app/
RUN (cd /opt/app/ && npm install --production)

