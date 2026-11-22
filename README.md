# Thuis: eigen TV-startscherm

Eén gedeeld startscherm (HTML in `shared/web`) met per apparaat een eigen laag:

| Platform | Map | Status |
|---|---|---|
| Formuler Z11 Pro Max (Android TV) | `app/` | eerste versie |
| Samsung The Frame (Tizen) | `tizen/` | volgt |

## Wat de Android-versie doet
- Draait als startscherm (Home-knop) en als gewone app.
- Rijen: Verder kijken (voorbeeld, Plex volgt), Nu live, Aanbevolen (voorbeeld), Apps.
- Live tv via Dispatcharr met een Xtream Codes-login. Je vult server, gebruikersnaam en wachtwoord in via Instellingen op de tv. Die gegevens staan alleen op het apparaat.
- Speler: omhoog/omlaag zappen, OK = zenderlijst, links/rechts of Info = infobalk met nu/straks, cijfers = zendernummer, Terug = startscherm.
- De korte gids (nu/straks) wordt bij elke zap en elke 5 minuten opnieuw opgehaald.

## Bouwen
Elke push naar `main` bouwt via GitHub Actions een APK. De nieuwste staat onder Releases als `laatste`.
