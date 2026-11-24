# Sjuul TV: eigen tv-startscherm

Eén gedeeld startscherm (HTML in `shared/web`) met per apparaat een eigen laag. Alle gegevens komen van **tv-serverr** (`server/`); de tv kent geen wachtwoorden of sleutels.

| Platform | Map | Status |
|---|---|---|
| Android TV (JBL, Formuler, ander Android-kastje) | `app/`, smaak `tv` | in gebruik, testkanaal |
| Android-telefoon en -tablet | `app/`, smaak `telefoon` | testkanaal |
| Samsung The Frame (Tizen 6) | `tizen/` (schil, schermen meegeleverd) | testapp |
| iPad, iPhone, browser | `shared/web/telefoon.html` via tv-serverr (`/app/telefoon.html`) | testkanaal |

## Wat Sjuul TV doet
- Zijbalk als menu (Terug of links tegen de rand): profiel, Zoeken, Thuis, Live tv, Films, Series, Bibliotheek, Mijn lijst, de apps en Instellingen.
- Startscherm: de apps (per profiel te ordenen), Nieuw voor jou, een rij met je favoriete genre en wat populair is maar je niet hebt.
- Live tv met gids (een week terug en vooruit), terugkijken, pauzeren en spoelen.
- Films en Series uit Plex en IPTV samen: één tegel per titel, Verder kijken (gedeeld tussen Plex en IPTV), opnames, genres, collecties en een raster met filters.
- Infopagina met seizoenen, cast, extra's, trailers en meer zoals dit. Streamingdiensten staan er alleen ter informatie bij ("Ook op").
- Zoeken als lijst met filters: zenders, nu live, straks, terugkijken, je eigen films en series, YouTube live.
- Profielen met eigen avatar, lijst, bekeken, voorkeuren en volgorde van de apps. Bij elk aanzetten "Wie kijkt er?".
- Afstandsbediening: Home gaat altijd naar het beginscherm, Terug altijd één stap terug.
- Eén lettertype overal (Inter), ook in de spelers en de gids.
- Schermbeveiliging als Android-schermbeveiliging (werkt ook in andere apps): filmbeelden van je eigen titels, drie eigen fotoalbums, kunst (Art Institute of Chicago, CC0) of alleen klok en weer.
  Eenmalig aanzetten met adb: `settings put secure screensaver_components com.meereboer.thuis/.Saver`, `settings put secure screensaver_enabled 1`, `settings put secure screensaver_activate_on_sleep 1` en `appops set com.meereboer.thuis WRITE_SETTINGS allow`.

## Bouwen
- Thuis: eerst op de testtak (release "test"), daarna `main` (release "laatste"). Zie `CLAUDE.md`.
- tv-serverr: push naar `main` bouwt het image; docker-media haalt het zelf op.
