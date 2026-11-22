# Thuis op Samsung (Tizen)

Dezelfde homescreen als op de Formuler, voor de Samsung The Frame (Tizen 6, 2021).

- `config.xml` – app-instellingen voor Tizen
- `thuis-tizen.js` – platformlaag: Dispatcharr, categorieën, TMDB, Plex, Jellyfin, IPTV-films/series,
  Radarr/Sonarr, OpenSubtitles en de Samsung-speler (AVPlay)
- Het startscherm zelf komt uit `shared/web/`

GitHub Actions bouwt bij elke push `thuis-samsung-ongesigneerd.wgt` (release "laatste").

## Installeren (later)
1. Tv: Apps › typ 12345 › Developer mode aan, IP van de pc invullen, tv herstarten.
2. Pc: TizenBrew Device Manager (of Tizen Studio) › verbinden met het IP van de tv.
3. Het pakket wordt bij installeren gesigneerd met een certificaat voor deze tv en daarna geïnstalleerd.

## Verschillen met de Formuler
- Streamingapps (Netflix enz.) openen gewoon op de Samsung zelf; geen JBL nodig.
- Ziggo: de tegel "Ziggo (HDMI)" verschijnt als `hdmiWebhook` is ingesteld (Home Assistant wisselt de bron).
- Geluid en ondertitels: groene en gele knop, net als op de Formuler.
