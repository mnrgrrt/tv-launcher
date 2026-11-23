#!/bin/sh
# Haalt de nieuwste tv-serverr op (gebouwd door GitHub) en start die, alleen als er echt iets nieuws is.
# De server maakt bij een nieuwe versie zelf eerst een kopie van zijn database.
IMG=ghcr.io/mnrgrrt/tv-serverr:latest
old=$(docker inspect -f '{{.Image}}' tv-serverr 2>/dev/null)
docker pull -q "$IMG" >/dev/null 2>&1 || exit 0
new=$(docker image inspect -f '{{.Id}}' "$IMG")
[ "$old" = "$new" ] && exit 0
logger -t tv-serverr-update "nieuwe versie gevonden, tv-serverr wordt herstart"
docker rm -f tv-serverr >/dev/null 2>&1
docker run -d --name tv-serverr --restart unless-stopped --network host \
  --env-file /opt/tv-serverr/.env -v /opt/tv-serverr/data:/data \
  --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges "$IMG" >/dev/null
docker image prune -f >/dev/null 2>&1
