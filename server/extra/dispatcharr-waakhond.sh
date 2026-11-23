#!/bin/sh
# Dispatcharr gebruikt het netwerk van gluetun. Start gluetun opnieuw (update, herstart, backup),
# dan blijft Dispatcharr aan het oude netwerk hangen en antwoordt niet meer.
# Dit script kijkt elke minuut. Drie keer achter elkaar geen antwoord: Dispatcharr herstarten.
fails=0
while true; do
  sleep 60
  if curl -s -o /dev/null -m 10 http://127.0.0.1:9191/; then fails=0; continue; fi
  [ "$(docker inspect -f '{{.State.Running}}' gluetun 2>/dev/null)" = "true" ] || { fails=0; continue; }
  [ "$(docker inspect -f '{{.State.Running}}' dispatcharr 2>/dev/null)" = "true" ] || { fails=0; continue; }
  started=$(docker inspect -f '{{.State.StartedAt}}' dispatcharr)
  age=$(( $(date +%s) - $(date -d "$started" +%s 2>/dev/null || echo 0) ))
  [ "$age" -lt 180 ] && continue          # net gestart: even laten opwarmen
  fails=$((fails + 1))
  if [ "$fails" -ge 3 ]; then
    logger -t dispatcharr-waakhond "Dispatcharr antwoordt niet, herstart"
    docker restart dispatcharr >/dev/null
    fails=0
  fi
done
