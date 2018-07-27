FROM alpine:3.7
RUN apk update
RUN apk add nodejs graphicsmagick g++ make
ADD . /opt/app/
RUN (cd /opt/app/ && npm install --production)

