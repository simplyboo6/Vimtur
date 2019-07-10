FROM node:10-alpine
RUN apk update
RUN apk add graphicsmagick g++ make ffmpeg

ADD . /opt/app/
WORKDIR /opt/app
RUN yarn
RUN yarn lint
RUN yarn lint-web

CMD ["yarn", "start"]
