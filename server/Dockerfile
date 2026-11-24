# tv-serverr: Node 22 met ingebouwde SQLite, geen npm-pakketten. ffmpeg voor het omzetten naar HLS (Safari, databesparing).
FROM node:22-alpine
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production THUIS_DATA=/data PORT=8484
WORKDIR /srv/server
COPY server/package.json ./
COPY server/src ./src
COPY server/public ./public
COPY shared /srv/shared
ARG VERSION=dev
ENV THUIS_VERSION=$VERSION
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8484
VOLUME /data
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8484/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
