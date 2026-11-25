# Werkafspraken voor Thuis en tv-serverr

Dit bestand geldt voor elke sessie in dit project. Lees het eerst, houd je eraan, en werk het bij als er iets verandert.

## Wat het is
- **Sjuul TV** (eerst "Thuis"): eigen tv-startscherm (Android-app in `app/`, smaak `tv`, schermen in `shared/web/index.html` + `thuis.js`). Op de Samsung The Frame voorlopig een testapp (`tizen/`, release "test", `sjuul-samsung-test.wgt`): schil met de schermen van dezelfde testversie (map `app/` in het pakket) en AVPlay als motor onder de speler. Samsung laat de Home-knop niet over; een Android-kastje is het alternatief. Installeren doet Gerry zelf.
- **Sjuul TV telefoon**: zelfde app, smaak `telefoon` (`shared/web/telefoon.html` + `telefoon.js`). Release `telefoon-test` / `telefoon`, bestand `sjuul-telefoon.apk`. Gedeelde logica in `shared/web/kern.js`.
- **Webversie (iPad, iPhone, browser)**: `telefoon.html` rechtstreeks van tv-serverr (`/app/telefoon.html`), koppelen met een cookie. Daarom: alle opmaak en logica in `shared/web/`, en alleen wat per platform verschilt via `window.Native` (koppelen, server-aanroepen, spelers, updaten, `features()`). Geen Android-only trucs in de webcode.
- **Webversie afspelen**: tv-serverr zet alles om naar HLS (fMP4). Chrome, Edge en Firefox spelen dat af via hls.js (`shared/web/lib/`, Apache-2.0, pas geladen als het nodig is); Safari op iPad/iPhone speelt zelf af. De eigen HLS-speler van Chrome niet gebruiken: die ziet een groeiende lijst als live tv en springt vooruit. Kort adres: `/web`.
- **HLS op de server** (`server/src/hls.js`): geen edit list (`use_editlist=0`, anders loopt geluid voor in browsers), geluid altijd opnieuw naar AAC, HEVC alleen kopiëren uit filmbestanden en als de browser het kan (`hevc` van de speler), anders H.264 8-bit tot 1080p. Bij film halverwege: beginnen bij het sleutelbeeld ervoor. Filmbestanden lezen max 4x kijksnelheid (na 30 s), niet bij tv-streams. Stopt de bron te vroeg (Dispatcharr kapt af), dan gaat een nieuwe ronde verder in dezelfde lijst (r0, r1, ... met DISCONTINUITY). Live: laatste 30 min bewaard, dus pauze in de webversie zonder terugkijken. Bestanden in `/data/hls` (niet /tmp: dat is RAM). Film-sessie 20 min bewaard op pauze, live 1 min.
- **Testen in de browser**: `Speler.stand()` (positie, lengte, ondertitel) en `Speler.spoel(sec)`.
- **Eén speler** (`shared/web/speler.js` + `speler.css`): knoppen, zappen, spoelen en kijkstand voor alle apparaten. Per apparaat alleen de motor eronder: browser (HLS via `/api/hls/start`, ffmpeg op de server) AVPlay (Samsung-testapp) en straks ExoPlayer (Android), via `window.SpelerMotor`. Daarna gaan de Kotlin-spelers eruit.
- **tv-serverr**: de server (`server/`, Node 22, SQLite, geen npm-pakketten). Draait als Docker-container in docker-media (LXC 107, Proxmox-node dell), poort 8484, beheer op `/beheer`.
- Tv's praten alleen met tv-serverr. Alle sleutels en wachtwoorden (Dispatcharr, Plex, TMDB, OpenSubtitles, Radarr, Sonarr, Home Assistant) staan alleen op de server.

## Kwaliteit: geen ding op ding
- Een proef om te zien of iets werkt mag één keer. Daarna wordt het goed gebouwd en gaat de proef eruit.
- Vervangt iets nieuws iets ouds, dan gaat het oude in dezelfde ronde weg. Nooit twee manieren naast elkaar laten bestaan zonder reden en zonder einddatum.
- Bij elke grotere stap terugkijken: wat is overbodig geworden, wat kan simpeler, wat is niet veilig? Opruimen hoort bij de stap, niet bij "later".
- Liever één heldere manier dan drie halve. Liever minder code dan meer.
- Na het opruimen nagaan dat niets meer naar de verwijderde code verwijst, en bouwen.

## Veiligheid
- Geheimen nooit in de code, nooit op GitHub, nooit op de tv. Alleen in de server (database of `.env` in docker-media).
- Tv's krijgen alleen ondertekende links die verlopen (streams, plaatjes, foto's). Geen tokens in links naar de tv.
- Elke nieuwe server-functie: wie mag dit (gekoppeld apparaat, beheerder, profiel), en wat als iemand rare invoer stuurt?
- Beheer alleen met naam en wachtwoord; wijzigingen in het logboek.
- Camera's en Home Assistant-knoppen (later): alleen voor profielen die het mogen, en alleen op apparaten die thuis zijn.

## Werkwijze
- Thuis: eerst bouwen op het testkanaal (tak `thuis-1` of een andere testtak, release "test"). Pas als het werkt naar `main` (release "laatste", gaat naar alle tv's).
- Versies: zichtbaar 1.00, 1.01, ... (`app/versie.txt`); het interne nummer loopt altijd door.
- tv-serverr: push naar `main` bouwt het image; docker-media haalt het binnen een kwartier zelf op (of knop "Nu bijwerken"). De server maakt bij een nieuwe versie zelf een kopie van zijn database.
- Testen waar het kan: de server hier lokaal draaien en de API en beheerpagina echt aanroepen voordat iets naar `main` gaat.
- Bediening op de tv: alles moet kunnen met pijltjes, OK en terug. Lang indrukken alleen als snelkoppeling.

## Systemen van Gerry
- Altijd eerst een backup voordat er iets verandert in Proxmox, Home Assistant of OPNsense.
- Commando's in een LXC voert Gerry zelf uit in de shell van dell: geef één gecombineerd blok, met `( ... )` eromheen zodat vragen (`read`) niet de volgende geplakte regel opeten.
- docker-media backuppen in stop-modus (`vzdump 107 --mode stop`); de snapshot-modus bleef eerder hangen. Na een herstart van docker-media kan Dispatcharr (netwerk van gluetun) blijven hangen; de waakhond lost dat op.
- Firewall (OPNsense): Gerry past regels zelf aan, met stap-voor-stap uitleg.
- Wachtwoorden typt Gerry zelf; Claude vult geen wachtwoorden in.

## Taal
- Alles voor Gerry in gewoon, begrijpelijk Nederlands. Korte zinnen. Geen lange gedachtestreepjes.
- Code-commentaar en teksten in de app ook in het Nederlands.
