# Thuis: eigen tv-startscherm

Eén gedeeld startscherm (HTML in `shared/web`) met per apparaat een eigen laag. Alle gegevens komen van **tv-serverr** (`server/`); de tv kent geen wachtwoorden of sleutels.

| Platform | Map | Status |
|---|---|---|
| Android TV (JBL, Google TV) | `app/` | in gebruik, testkanaal |
| Samsung The Frame (Tizen) | `tizen/` | voorbereid |

## Wat Thuis doet
- Startscherm met Verder kijken (per profiel, zelf weg te halen), Nu live, Streamingdiensten, Voor jou, Binnenkort en Apps.
- Live tv met gids (een week terug), terugkijken, pauzeren en spoelen. In de speler: omhoog/omlaag zappen, OK = balk met knoppen.
- Films en Series uit Plex en IPTV samen: één tegel per titel, genres, collecties, rijen per dienst en een raster met filters.
- Zoeken als lijst met filters: zenders, nu live, straks, terugkijken, films en series.
- Profielen met eigen avatar, lijst, diensten en voorkeuren.

## Bouwen
- Thuis: eerst op de testtak (release "test"), daarna `main` (release "laatste"). Zie `CLAUDE.md`.
- tv-serverr: push naar `main` bouwt het image; docker-media haalt het zelf op.
