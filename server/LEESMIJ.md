# tv-serverr

Server voor Thuis. Houdt de koppelingen (Dispatcharr, Plex, TMDB, OpenSubtitles, Radarr, Sonarr), profielen,
kijkstanden, Mijn lijst en de gids bij op één plek. Tv's praten alleen nog met deze server.

## Beveiliging
- Alle sleutels en wachtwoorden blijven op de server. Streams en plaatjes lopen via de server met ondertekende links die verlopen.
- Alleen gekoppelde tv's krijgen antwoord. Koppelen met een code van 6 cijfers (10 minuten geldig) uit de beheerpagina.
- Beheer (instellingen, koppelen, profielen) alleen met de pincode uit `THUIS_ADMIN_PIN`. Zonder pincode is beheer dicht.
- Na 5 foute codes of pincodes: een kwartier wachten.
- Container draait als gebruiker `node`, zonder extra pakketten van anderen.

## Draaien
Image: `ghcr.io/mnrgrrt/tv-serverr:latest`, poort 8484, data in `/data`.
Beheer: `http://<server>:8484/beheer`.
