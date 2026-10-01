# stream-musik.space

Statische, mehrseitige GitHub-Pages-Website für das Webradio **jackdarckart** auf laut.fm.

## Überblick

Die Website bleibt bewusst eine kleine, statische Radio-Web-App ohne Build-Pipeline und ohne externe Frontend-Abhängigkeiten. Sie ergänzt den offiziellen laut.fm-Stream um:

- direkte Browser-Wiedergabe nach echter Nutzeraktion
- interne Seitennavigation ohne vollständigen Reload: die Shell bleibt bestehen und tauscht nur `main#content`/Navigationsmarkierungen aus, damit derselbe laufende Webplayer beim Seitenwechsel erhalten bleibt
- sichtbare Status-, Fehler-, Retry-, Puffer- und Offline-Hinweise
- kompakte Startseite plus getrennte Inhaltsseiten für Live, Titel, Converter-Studio, Sendeplan, Events, News, Archiv, Hilfe, Issue-Hilfe, Kontakt, Datenschutz und Impressum
- Sleep-Timer, Tastaturkürzel, Theme-Umschaltung, lokale Favoriten, Filter-/Kopierhilfen und Share-Funktionen
- Live-Daten aus der offiziellen laut.fm-API für Songs, Senderprofil, Hörerzahl, Next Artists und Sendeplan
- informative Fehler-/Leerzustände ohne erfundene Termine, Titel, Hörerzahlen oder Archivdaten
- installierbare PWA mit Service Worker für statische App-Shell-Ressourcen
- GitHub-Pages-kompatible relative Links, restriktive CSP und barrierearme Navigation

## Designkonzept (aktuell)

Das Frontend nutzt eine gemeinsame, modernisierte Markenoberfläche für alle zwölf Seiten:

- neue Glass-/Gradient-Ästhetik mit klarer Typo-Hierarchie und konsistenten Oberflächen in Dark- und Light-Theme
- responsive Raster- und Spacing-Logik für Desktop, Tablet und Mobile mit reduzierten Umbrüchen in Navigation und Content-Modulen
- neu integrierter Sticky-Player mit viewport-sicherer Breite, Safe-Area-Abständen und mobiler Einspalten-Aktion
- visuell zusammenhängende Bereiche für Hero, Player, Editorial-Module, Timeline und Feed ohne zusätzliche Build- oder UI-Abhängigkeiten
- defensive Motion-Strategie mit sofort sichtbarem Fallback bei `prefers-reduced-motion`

## Pflegehinweise für Inhalte

Damit keine erfundenen Inhalte erscheinen:

- bestätigte Daten in `APP_CONFIG.content.schedule/events/news/archive` pflegen
- bei fehlenden Daten lieber die vorhandenen erklärenden Empty States beibehalten
- Kontakt- und Impressumsangaben erst nach Verifikation ergänzen
- optionale Plattform-Links nur nach Prüfung in `APP_CONFIG.content.platformLinks` setzen

## Mitwirken über GitHub Issues

Dieses Projekt nutzt **GitHub Issues als zentrale Stelle** für Fehlerberichte, Feature-Wünsche, Inhaltskorrekturen, Design-/UX-Ideen und API-/Echtzeitdaten-Probleme. Die Website verweist deshalb sichtbar auf `issue-hilfe.html` und auf die Repository-Issues unter:

- `https://github.com/jackdarckart/jackdarckart/issues`
- `https://github.com/jackdarckart/jackdarckart/issues/new/choose`

### Erwartete Angaben in einem guten Issue

Ein hochwertiges Issue enthält nach Möglichkeit:

- einen präzisen Titel
- Ziel und Relevanz
- aktuellen Zustand und gewünschten Zustand
- reproduzierbare Schritte oder klaren Kontext
- Umgebung (Gerät, Browser, Betriebssystem, Uhrzeit, betroffene Seite)
- echte Screenshots, Logs oder API-Hinweise
- verifizierte Datenquellen statt Vermutungen

### Was ausdrücklich nicht in Issues stehen soll

- erfundene Songs, Events, Sendungen oder Social-Profile
- unbestätigte Daten als angebliche Echtzeit-Fakten
- Platzhalter wie „später ergänzen“ oder rein vage Beschreibungen

### Repository-Vorlagen

Unter `.github/ISSUE_TEMPLATE/` liegen deutschsprachige Vorlagen für:

- `bug_report.md`
- `feature_request.md`
- `content_request.md`
- `design_ux_improvement.md`
- `api_realtime_problem.md`

Bitte vor dem Erstellen eines neuen Issues zuerst vorhandene offene Themen durchsuchen und anschließend den passenden Typ wählen.

## Seitenstruktur

- `index.html` – kompakte Startseite mit Live-Status, Schnellzugriffen und Übersicht
- `live.html` – vollständige Live-Hören-Seite mit großem Player, Lautstärke, Retry, Sleep-Timer und Tastaturkürzeln
- `titel.html` – aktueller Titel, Historie, lokale Favoriten, Bibliotheksfilter und schnelle Kopieraktionen
- `converter.html` – Browser-Studio für lokale Dateien, Waveform/Spectrum, automatische Song-Qualitätsverbesserung (Qualitäts-Score, Befundliste, drei Stärken, Auto-Anwendung nach dem Import, Rückgängig), Mastering-Regler, WAV- und gebündelten MP3-Export mit 2-Minuten-Cleanup sowie optionalem Cloud-Sync für Studio-Presets über das Cloudflare-Backend
- `game.html` – eigenständiges „Singularity Arcade — Quantum Vault“ mit Account, servervalidierter Progression und Leaderboard

- `sendeplan.html` – aktueller und kommender Sendeplan mit Jetzt-live-/Als-Nächstes-Logik plus Zeitraumfilter für kommende Einträge
- `events.html` – bestätigte Events und Specials oder professioneller Leerzustand
- `news.html` – Sender-/Website-Neuigkeiten oder redaktioneller Leerzustand
- `archiv.html` – Mix-/Sendungsarchiv mit ehrlichem Leerzustand für verifizierte Inhalte
- `ueber-uns.html` – Einordnung von jackdarckart und stream-musik.space
- `hilfe.html` – umfangreiche Hilfe/FAQ zu Wiedergabe, PWA, Datenverbrauch, Theme und Tastatursteuerung
- `issue-hilfe.html` – ausführliche GitHub-Issue-Hilfe mit Checklisten, Qualitätsregeln und deutschsprachigen Vorlagen
- `kontakt.html` – Songwünsche, Feedback, technische Fehler und Sicherheitsmeldungen
- `datenschutz.html` – sachliche Datenschutz- und Sicherheitsinformationen
- `impressum.html` – Impressum mit Anbieterkennzeichnung, Kontakt und Verantwortlichkeit

Auto-Enhance schätzt lokal in einem schnellen Durchlauf Frequenzbalance, Dynamik (Crest-Faktor und Lautheitsumfang), gegatete Lautheit, Clipping, Stereo-Korrelation, Kanalbalance sowie Rumpeln/DC-Versatz. Jeder Befund wird nach Schweregrad gewichtet: Daraus entstehen der Qualitäts-Score, eine Prognose nach dem Mastering und die Korrekturintensität – schwache Quellen werden deutlich kräftiger korrigiert, saubere Quellen nur behutsam. Bei auffälligen Höhen, Transienten, phasigem Stereo oder Rumpeln werden gezielte DSP-Korrekturen (Ringing-Cut, Höhen-Glättung, Transienten-Kontrolle, Rumpel-Filter) zugeschaltet. Dies sind Heuristiken, keine KI-Modell- oder Broadcast-Loudness-Messung; falls die Analyse fehlschlägt, bleibt das klassische Preset nutzbar.

## Technische Struktur

- `styles.css` – gemeinsames Layout, Navigation, Mehrseiten-Komponenten und Player-Styling
- `app.js` – defensive Initialisierung für alle Seiten, Player-Logik, Sendeplan-/Inhalts-Rendering, Theme, PWA und lokale Komfortfunktionen
- `converter.js` – browserseitiger DSP-/Render-Workflow für `converter.html` inklusive Quellenanalyse mit Qualitäts-Score und Befunden, Auto-Enhance in den Stärken sanft/ausgewogen/kräftig, lokaler Preview, Waveform/Spectrum, MP3/WAV-Export, Cleanup-Timer und `CloudflareStudioSyncAdapter` für Studio-Presets
- `game.js` / `game.css` – eigenständige Spieloberfläche und responsives Sci-Fi/HUD-Design
- `server/quantum-vault.js` – Pure-Node-Server mit scrypt-Accounts, HttpOnly-Sessions, verschlüsselter Vault-Persistenz und serverseitigen Spielregeln
- `server/suno-downloader.js` – dedizierte, abgesicherte Node-Referenzimplementierung des Suno-Downloaders mit SSRF-Schutz und Signaturprüfung
- `server/remote-audio-proxy.js` – optionale Node-Referenzimplementierung des Same-Origin-Resolvers für CORS-blockierte Remote-Audio-Importe
- `assets/vendor/lame.min.js` – gebündelter lokaler MP3-Encoder (`lamejs` 1.2.1, LGPL-3.0) für privacy-first Export ohne Upload
- `manifest.webmanifest` – PWA-Metadaten und Mehrseiten-Shortcuts
- `sw.js` – App-Shell-Cache für alle HTML-Seiten und statischen Assets, ohne Stream-Caching
- `tests/app.test.js` – Node-basierte Regressionstests für kritische UI-/Player- und Strukturregeln
- `tests/quantum-vault.test.js` – fokussierte Account-, Session-, Vault- und Manipulationsschutz-Tests
- `cloudflare/` – wiederverwendbares Cloudflare-Backend-Starterpaket (Workers + D1 + KV) für künftige Integrationen, siehe [`cloudflare/README.md`](cloudflare/README.md)
- `tests/cloudflare-worker.test.js` – Worker-Tests mit In-Memory-Doubles für D1 und KV

## Studio-Cloud-Sync über Cloudflare

Das Converter-Studio speichert Presets nicht mehr über einen Platzhalter, sondern über das Cloudflare-Backend in [`cloudflare/`](cloudflare/README.md) (Workers + D1 + KV). Synchronisiert werden ausschließlich die Regler (EQ, Kompressor, Limiter, Stereo-Width, Loudness-Ziel) sowie Modus und Stärke der automatischen Qualitätsverbesserung – Audiodateien und Renders verlassen den Browser nie.

Aktiviert wird der Sync, indem die Worker-Adresse konfiguriert wird (HTTPS oder Same-Origin-Pfad):

```js
window.__JACKDARCKART_CONFIG__ = {
  converter: {
    cloudSync: { apiBase: 'https://vault.stream-musik.space/api/quantum-vault' }
  }
};
```

Ohne Konfiguration zeigt das Studio ehrlich „Cloud-Sync ist auf dieser Website noch nicht eingerichtet“ und kontaktiert kein Backend. Mit Konfiguration können sich Nutzer im Studio anmelden oder einen Account erstellen; Anfragen laufen mit `credentials: 'include'` über das HttpOnly-Session-Cookie des Workers (`GET`/`POST /studio-preset`). Die Website-Origin muss in `ALLOWED_ORIGINS` des Workers stehen, und die Migration `cloudflare/migrations/0002_studio_presets.sql` muss angewendet sein.

## Quantum Vault lokal starten

Der Vault benötigt einen ausschließlich serverseitigen 32-Byte-Schlüssel. Es wird kein Schlüssel im Repository mitgeliefert:

```bash
export QUANTUM_VAULT_KEY="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
npm start
```

Anschließend ist das Spiel unter `http://localhost:8080/game.html` erreichbar und nutzt auf `localhost` oder `127.0.0.1` automatisch die lokale API. Accounts und verschlüsselte Spielstände werden standardmäßig in `data/quantum-vault.json` gespeichert; dieser Pfad ist von Git ausgeschlossen. Für persistente Deployments kann `QUANTUM_VAULT_DATA_FILE` auf einen privaten, dauerhaften Datenträger zeigen.

Fehlt `QUANTUM_VAULT_KEY` oder ist er ungültig, bricht `npm start` mit einer klaren Meldung samt Befehl zum Erzeugen eines Schlüssels ab (der Schlüssel selbst wird nie geloggt). `GET /api/quantum-vault/health` liefert ohne Geheimnisse `{"ok":true,"service":"quantum-vault","status":"ready"}` als Readiness-Check. Fehlerantworten der API enthalten neben `error` einen stabilen `code` (z. B. `INVALID_CREDENTIALS`, `HANDLE_TAKEN`, `HANDLE_INVALID`, `PASSWORD_INVALID`, `RATE_LIMITED`, `SESSION_REQUIRED`), den `game.js` in verständliche deutsche Hinweise übersetzt. Auf rein statischem Hosting nutzt `game.html` standardmäßig den Cloudflare-Worker unter `https://vault.stream-musik.space/api/quantum-vault` statt einer lokalen API. Für lokale Entwicklung oder eine andere Route kann vor dem Laden von `game.js` über ein gleich-originiges Skript `window.__JACKDARCKART_CONFIG__ = { game: { apiBase: '/api/quantum-vault' } };` gesetzt werden; für andere HTTPS-Hosts muss außerdem `connect-src` in `game.html` angepasst und die Website-Origin in `ALLOWED_ORIGINS` des Workers freigegeben werden. D1, KV, Migrationen und die Worker-Route müssen wie in [`cloudflare/README.md`](cloudflare/README.md) beschrieben eingerichtet sein. Browser-Requests senden das HttpOnly-Session-Cookie mit `credentials: 'include'`. Bestehende Node-Vault-Accounts werden nicht automatisch in D1 migriert. Der Browser sendet niemals Account-IDs oder vollständige Spielstände: Aktionen werden im Server berechnet, private Antworten tragen `Cache-Control: no-store, private`.

## Live-Daten aus der offiziellen laut.fm-API

`app.js` baut seine Laufzeitkonfiguration aus `window.__JACKDARCKART_CONFIG__ || {}` auf und nutzt standardmäßig **direkt** die offiziellen Endpunkte für die Station `jackdarckart`:

- `https://api.laut.fm/station/jackdarckart/current_song`
- `https://api.laut.fm/station/jackdarckart/last_songs`
- `https://api.laut.fm/station/jackdarckart/schedule`
- `https://api.laut.fm/station/jackdarckart`
- `https://api.laut.fm/station/jackdarckart/listeners`
- `https://api.laut.fm/station/jackdarckart/next_artists`

### Tatsächlich ausgewertete API-Felder

Die Frontend-Validierung verwendet nur bestätigte, defensive Feldnamen und ignoriert alles andere:

- `current_song`: `title`, `artist.name`, `album`, `art`, `started_at`, `ends_at`
- `last_songs`: Array aus Songobjekten mit denselben relevanten Songfeldern
- `schedule`: `starts`, `ends`, `playlist.name`, `description`, `type`, optionale URLs
- `station`: `display_name`, `name`, `description`, `genres`, `page_url`, `stream_url`, `images`/`logo`
- `listeners`: `listeners`
- `next_artists`: `name`

Wenn Felder fehlen, werden sie **nicht** frei ergänzt. Cover, Listener-Zahl, Genres oder Next Artists erscheinen nur bei gültigen API-Werten.

### Polling, Timeout und Fehlerverhalten

- Songs / letzte Titel / Listener / Next Artists: Standard-Polling `45000 ms`
- Station-Profil: Standard-Polling `180000 ms`
- Sendeplan: Standard-Polling `180000 ms`
- Request-Timeout: `12000 ms`
- Race-Protection: veraltete API-Antworten werden verworfen
- Cleanup: Polling-Timer werden auf `pagehide` beendet

Bei API-Fehlern gilt:

- **Now Playing** zeigt keinen erfundenen Titel
- der letzte erfolgreiche Abrufzeitpunkt bleibt sichtbar
- ein manueller **„Jetzt aktualisieren“**-Button bleibt verfügbar
- Historie und Sendeplan melden ehrlich, wenn die API gerade leer oder unerreichbar ist

### Optionale Same-Origin-Proxy-Konfiguration

Falls der direkte Browserzugriff wegen CORS, DNS oder Netzrestriktionen in deiner Zielumgebung fehlschlägt, kann ein echter Same-Origin-Proxy vorgeschaltet werden. GitHub Pages selbst liefert keinen Backend-Proxy mit; deshalb wird kein Fake-Fallback behauptet.

Beispiel:

```js
window.__JACKDARCKART_CONFIG__ = {
  lautFm: {
    proxyBase: '/api/lautfm/station/jackdarckart',
    pollIntervalMs: 45000,
    stationPollIntervalMs: 180000,
    schedulePollIntervalMs: 180000,
    requestTimeoutMs: 12000,
    scheduleTimeZone: 'Europe/Berlin'
  }
};
```

`proxyBase` muss dieselben offiziellen Endpunkte spiegeln, also z. B.:

- `/api/lautfm/station/jackdarckart/current_song`
- `/api/lautfm/station/jackdarckart/last_songs`
- `/api/lautfm/station/jackdarckart/schedule`
- …

### Statische Inhaltsbereiche

Folgende Inhalte bleiben zentral über `APP_CONFIG.content` pflegbar:

- `events`
- `news`
- `archive`
- `platformLinks`
- `contact`

## Lokale Vorschau

Im Repository-Root einen einfachen statischen Server starten:

```bash
cd /home/runner/work/jackdarckart/jackdarckart
python3 -m http.server 8000
```

Danach z. B. diese Seiten im Browser prüfen:

- `http://127.0.0.1:8000/index.html`
- `http://127.0.0.1:8000/live.html`
- `http://127.0.0.1:8000/titel.html`
- `http://127.0.0.1:8000/converter.html`
- `http://127.0.0.1:8000/sendeplan.html`

## Tests

Leichtgewichtige Regressionstests laufen mit:

```bash
cd /home/runner/work/jackdarckart/jackdarckart
node --check app.js
node tests/app.test.js
```

Sinnvolle manuelle Prüfungen:

1. Navigation, aktive Seitenmarkierung, Mobile-Drawer und laufende Wiedergabe beim Wechsel zwischen mehreren Seiten prüfen
2. `index.html`, `live.html`, `titel.html` und `sendeplan.html` mit erreichbarer laut.fm-API prüfen: Song, Historie, Sendeplan, Senderdaten, Listener und Next Artists
3. API-Fehlerfall simulieren: Browser offline oder Proxy deaktivieren und auf ehrliche Fehlerzustände mit letztem erfolgreichen Abruf achten
4. Live-Player auf `live.html` starten, pausieren, stummschalten, Retry + Offline-Hinweise testen
5. Theme wechseln und Seitenreload auf anderer Unterseite prüfen
6. Sticky-Quick-Access, Scroll-Reveal und Reduced-Motion-Fallback prüfen
7. PWA/Service Worker in Browser-DevTools prüfen (kein Stream-Caching)

## PWA / Offline

- Alle HTML-Seiten und statischen Assets liegen im App-Shell-Cache
- Navigationsanfragen fallen offline zuerst auf die angeforderte gecachte Seite zurück, dann auf `index.html`
- Der Live-Audiostream wird **niemals** gecacht

## Deployment

Die Website wird direkt aus dem Repository-Root über GitHub Pages veröffentlicht. Die Custom Domain bleibt über `CNAME` auf `stream-musik.space` gesetzt.

## Bekannte offene Konfigurationspunkte

- bestätigte Sendeplan-, Event-, News- und Archivdaten pflegen
- reale Kontaktadresse und rechtlich geprüfte Impressumsangaben eintragen
- optional Social-/Plattform-Links nur nach Verifikation ergänzen
- optional echten Same-Origin-Proxy ergänzen, falls direkter Browserzugriff auf `api.laut.fm` in der Zielumgebung nicht möglich ist
