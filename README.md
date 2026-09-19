# stream-musik.space

Statische, mehrseitige GitHub-Pages-Website für das Webradio **jackdarckart** auf laut.fm.

## Überblick

Die Website bleibt bewusst eine kleine, statische Radio-Web-App ohne Build-Pipeline und ohne externe Frontend-Abhängigkeiten. Sie ergänzt den offiziellen laut.fm-Stream um:

- direkte Browser-Wiedergabe nach echter Nutzeraktion
- sichtbare Status-, Fehler-, Retry-, Puffer- und Offline-Hinweise
- kompakte Startseite plus getrennte Inhaltsseiten für Live, Titel, Sendeplan, Events, News, Archiv, Hilfe, Kontakt, Datenschutz und Impressum
- Sleep-Timer, Tastaturkürzel, Theme-Umschaltung, lokale Favoriten und Share-Funktionen
- informative Empty States ohne erfundene Termine, Titel oder Archivdaten
- installierbare PWA mit Service Worker für statische App-Shell-Ressourcen
- GitHub-Pages-kompatible relative Links, restriktive CSP und barrierearme Navigation

## Seitenstruktur

- `index.html` – kompakte Startseite mit Live-Status, Schnellzugriffen und Übersicht
- `live.html` – vollständige Live-Hören-Seite mit großem Player, Lautstärke, Retry, Sleep-Timer und Tastaturkürzeln
- `titel.html` – aktueller Titel, Historie, lokale Favoriten und Teilen
- `sendeplan.html` – aktueller und kommender Sendeplan mit Jetzt-live-/Als-Nächstes-Logik
- `events.html` – bestätigte Events und Specials oder professioneller Leerzustand
- `news.html` – Sender-/Website-Neuigkeiten oder redaktioneller Leerzustand
- `archiv.html` – Mix-/Sendungsarchiv mit ehrlichem Leerzustand für verifizierte Inhalte
- `ueber-uns.html` – Einordnung von jackdarckart und stream-musik.space
- `hilfe.html` – umfangreiche Hilfe/FAQ zu Wiedergabe, PWA, Datenverbrauch, Theme und Tastatursteuerung
- `kontakt.html` – Songwünsche, Feedback, technische Fehler und Sicherheitsmeldungen
- `datenschutz.html` – sachliche Datenschutz- und Sicherheitsinformationen
- `impressum.html` – deutlich markierte Impressum-Vorlage mit Platzhaltern

## Technische Struktur

- `styles.css` – gemeinsames Layout, Navigation, Mehrseiten-Komponenten und Player-Styling
- `app.js` – defensive Initialisierung für alle Seiten, Player-Logik, Sendeplan-/Inhalts-Rendering, Theme, PWA und lokale Komfortfunktionen
- `manifest.webmanifest` – PWA-Metadaten und Mehrseiten-Shortcuts
- `sw.js` – App-Shell-Cache für alle HTML-Seiten und statischen Assets, ohne Stream-Caching
- `tests/app.test.js` – Node-basierte Regressionstests für kritische UI-/Player- und Strukturregeln

## Konfiguration

`app.js` baut seine Laufzeitkonfiguration aus `window.__JACKDARCKART_CONFIG__ || {}` auf und mischt diese Overrides in die eingebauten Defaults.

### Now Playing

Standardmäßig wird keine externe Now-Playing-Quelle abgefragt. Erst eine bewusst konfigurierte **same-origin**-Quelle aktiviert Titelinfos und Historie.

Beispiel:

```js
window.__JACKDARCKART_CONFIG__ = {
  nowPlaying: {
    endpoint: './data/now-playing.json',
    pollIntervalMs: 45000,
    requestInit: {
      headers: {
        Accept: 'application/json'
      }
    },
    adapter: 'generic-json'
  }
};
```

### Statische Inhaltsbereiche

Folgende Inhalte bleiben zentral über `APP_CONFIG.content` pflegbar:

- `schedule.entries`
- `events`
- `news`
- `archive`
- `platformLinks`
- `contact`

Für `schedule.entries` gelten mindestens `day`, `start`, `end` und `title`. Die Live-/Next-Berechnung nutzt standardmäßig `Europe/Berlin`.

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
- `http://127.0.0.1:8000/sendeplan.html`

## Tests

Leichtgewichtige Regressionstests laufen mit:

```bash
cd /home/runner/work/jackdarckart/jackdarckart
node tests/app.test.js
```

Sinnvolle manuelle Prüfungen:

1. Navigation, aktive Seitenmarkierung und Mobile-Menü auf mehreren Seiten prüfen
2. Live-Player auf `live.html` starten, pausieren, stummschalten, Retry testen
3. Theme wechseln und Seitenreload auf anderer Unterseite prüfen
4. Sticky-Quick-Access und relative Links zu Unterseiten kontrollieren
5. PWA/Service Worker in Browser-DevTools prüfen

## PWA / Offline

- Alle HTML-Seiten und statischen Assets liegen im App-Shell-Cache
- Navigationsanfragen fallen offline zuerst auf die angeforderte gecachte Seite zurück, dann auf `index.html`
- Der Live-Audiostream wird **niemals** gecacht

## Deployment

Die Website wird direkt aus dem Repository-Root über GitHub Pages veröffentlicht. Die Custom Domain bleibt über `CNAME` auf `stream-musik.space` gesetzt.

## Bekannte offene Konfigurationspunkte

- echte same-origin-Quelle für Now Playing / Historie hinterlegen, falls Titelinfos gewünscht sind
- bestätigte Sendeplan-, Event-, News- und Archivdaten pflegen
- reale Kontaktadresse und rechtlich geprüfte Impressumsangaben eintragen
- optional Social-/Plattform-Links nur nach Verifikation ergänzen
