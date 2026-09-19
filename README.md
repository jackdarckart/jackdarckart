# stream-musik.space

Statische GitHub-Pages-Website für das Webradio **jackdarckart** auf laut.fm.

## Überblick

Die Website bleibt bewusst eine kleine, statische Radio-Web-App ohne Build-Pipeline und ohne externe Frontend-Abhängigkeiten. Sie bündelt den offiziellen laut.fm-Stream in einem browserfreundlichen Direktplayer und ergänzt ihn um:

- direkte Browser-Wiedergabe nach echter Nutzeraktion
- sichtbare Status-, Fehler-, Retry-, Puffer- und Offline-Hinweise mit verständlichen Diagnosehilfen
- ausgebauten Hero-/Startbereich mit Einordnung, Funktionsschritten und ehrlichen Eigenschaften statt Fantasiezahlen
- Now-Playing- und Historienbereich mit ehrlichem Fallback ohne erfundene Live-Daten
- Sleep-Timer, dokumentierte Tastaturkürzel, Theme-Hinweise, PWA-Erklärungen und lokale Favoriten ohne Backend
- Share-Funktionen für Website und Direktstream mit nativer Browser-API plus Clipboard-Fallback
- statischen Sendeplan sowie Songwunsch-/Feedback-Bereich via `mailto:` oder GitHub-Issue-Fallback
- informative Empty States für Sendeplan, Events, News, Archiv und Plattform-Links mit Pflegehinweisen statt Platzhalterwirkung
- ausgebauten FAQ-, Sicherheits-, Datenschutz-, Kontakt- und Footer-Bereich mit klarer Abgrenzung zwischen verifizierten Fakten und konfigurierbaren Inhalten
- installierbare PWA mit Manifest, Service Worker und App-Shell-Caching
- Dark/Light/Auto-Theme mit defensiver `localStorage`-Nutzung
- kontraststarkes, responsives Layout für Mobile, Tablet und Desktop

## Struktur

- `index.html` – semantische Startseite mit Meta-Tags, erweitertem Hero, Direktplayer-Markup, Sleep-Timer-/Favoriten-/Feedback-UI, PWA-/Now-Playing-/Historienbereichen und ausführlichen Inhaltssektionen
- `styles.css` – responsives Layout, Theme-Varianten, Player-UI, Statuskarten, Info-/Empty-State-Karten, Formular-/Schedule-Karten und Inhaltsdarstellung
- `app.js` – Navigation, Player-Logik mit Retry-/Reconnect-/Sleep-Timer-Verhalten, Theme/PWA/Share-/Favoriten-Logik, defensive Storage-Zugriffe, informative Empty States und konfigurierbare Datenquellen
- `manifest.webmanifest` – PWA-Metadaten für Installation und Branding
- `sw.js` – Service Worker für statische App-Ressourcen und Offline-Fallback ohne Audiostream-Caching
- `assets/app-icon.svg` – SVG-App-Icon
- `assets/app-icon-192.png` / `assets/app-icon-512.png` – PWA-Icons für Installationsdialoge
- `assets/social-preview.png` – Social-Preview-Bild für Open Graph/Twitter
- `CNAME` – Custom Domain `stream-musik.space`
- `tests/app.test.js` – schlanker Node-basierter Regressionstest für zentrale Player-, Theme-, Share- und Fallback-Flows

Die Website benötigt **keinen Build-Schritt** und wird direkt aus dem Repository-Root veröffentlicht.

## Informationsbereiche & Pflege

Die Seite erklärt bewusst jeden größeren Bereich auch dann, wenn noch keine Live- oder Inhaltsdaten gepflegt wurden. Das betrifft insbesondere:

- Hero/Startbereich (`index.html`) – Einordnung für neue Besucher, Eigenschaften der App und kurze Schritt-für-Schritt-Erklärung
- Player/Diagnose (`index.html`, `app.js`) – Statusbedeutungen, Retry-/Fallback-Hinweise, Autoplay-/Lautstärke-Erklärungen
- Now Playing & Historie (`app.js`, optional gleiche-Origin-Datenquelle) – nur echte Metadaten, sonst erklärender Fallback
- Sendeplan, Events, News, Archiv, Plattform-Links (`APP_CONFIG.content` in `app.js`) – bewusst informative Empty States statt erfundener Inhalte
- FAQ, Sicherheit, Kontakt und Footer (`index.html`) – statische Orientierungstexte mit ehrlicher Abgrenzung zwischen bestätigten Fakten und konfigurierbaren Angaben

Wichtig: Keine fiktiven Sendungen, Termine, Personen, Social-Profile oder Live-Daten eintragen. Leere Zustände sollen erklären, was hier später erscheinen kann und wo die Pflege erfolgt.

## Lokale Vorschau

Im Repository-Root einen einfachen statischen Server starten, zum Beispiel:

```bash
cd /home/runner/work/jackdarckart/jackdarckart
python3 -m http.server 8000
```

Danach im Browser `http://127.0.0.1:8000/` öffnen.

## Veröffentlichung mit GitHub Pages

1. Repository **jackdarckart/jackdarckart** öffnen
2. **Settings → Pages**
3. **Source:** `Deploy from a branch`
4. **Branch:** `main`
5. **Folder:** `/ (root)`

Die Custom Domain bleibt über `CNAME` auf `stream-musik.space` gesetzt.

## Konfiguration

### Now-Playing-Datenquelle

Die Seite fragt **standardmäßig keine externen Now-Playing-Daten** ab. Damit bleiben Datenschutz, CSP und GitHub-Pages-Kompatibilität im Ausgangszustand eng begrenzt.

`app.js` baut seine Laufzeitkonfiguration aus `window.__JACKDARCKART_CONFIG__ || {}` auf und mischt diese Overrides in die eingebauten Defaults. In dieser Repository-Version sind die Defaults direkt im Skript hinterlegt; wer lieber eine getrennte Konfigurationsdatei ausliefert, kann vor `app.js` ein eigenes, selbst gehostetes Skript laden, das `window.__JACKDARCKART_CONFIG__` setzt.

Der relevante Standardblock für Now Playing sieht in `app.js` so aus:

```js
nowPlaying: {
  endpoint: '',
  pollIntervalMs: 60000,
  requestInit: {},
  adapter: 'generic-json'
}
```

Erst wenn `endpoint` mit einer echten **same-origin**-Quelle gefüllt wird, startet Polling. Der enthaltene Adapter `generic-json` versucht gängige JSON-Felder wie `current`, `track`, `song`, `history`, `recent` oder `lastPlayed` defensiv auszulesen.

Beispiel für eine echte Override-Konfiguration:

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

Wichtig:

- Keine erfundenen oder unzuverlässigen Endpunkte verwenden.
- Ohne bewusste Anpassungen der Meta-CSP akzeptiert die App nur **same-origin**-Now-Playing-Quellen.
- Wenn dennoch eine **externe** API genutzt werden soll, muss die Meta-CSP in `index.html` unter `connect-src` passend ergänzt und die same-origin-Prüfung in `app.js` bewusst erweitert werden.
- Liefert die Quelle keine gültigen Titel-/Historieninformationen, zeigt die Oberfläche bewusst den Fallback `Titelinformationen derzeit nicht verfügbar`.

### Statische Inhalte pflegen

Events, News, Archiv, Plattform-Links und der Sendeplan werden ebenfalls zentral in `app.js` über `APP_CONFIG.content` gepflegt.

Beispielstruktur:

```js
content: {
  schedule: {
    timeZone: 'Europe/Berlin',
    entries: [
      {
        day: 'Freitag',
        start: '20:00',
        end: '22:00',
        title: 'Beispielsendung',
        host: 'DJ Beispiel',
        genre: 'House',
        description: 'Nur verwenden, wenn die Angaben verifiziert sind.',
        isPlaceholder: true
      }
    ]
  },
  events: [
    {
      title: 'Beispielplatzhalter',
      meta: 'nur verwenden, wenn verifiziert',
      description: 'Statische Beschreibung',
      url: 'https://example.invalid',
      linkLabel: 'Mehr erfahren'
    }
  ],
  news: [],
  archive: [],
  platformLinks: []
}
```

Leere Arrays sind ausdrücklich erlaubt; die Seite zeigt dann automatisch professionelle Leerzustände mit Pflegehinweis, Einsatzbereich und nächstem sinnvollen Schritt für die Pflege.

Für `schedule.entries` gilt:

- `day`: `0` bis `6` oder Wochentag wie `Montag`, `Freitag`, `Mon`
- `start` / `end`: `HH:MM` im 24h-Format
- `isPlaceholder: true` kennzeichnet bewusst nur Beispiel-/Platzhalterdaten
- der Live-/Next-Hinweis arbeitet standardmäßig mit `Europe/Berlin`
- Endzeiten dürfen numerisch vor der Startzeit liegen, wenn eine Sendung über Mitternacht hinausgeht
- ohne valide Zeiten oder Wochentage zeigt die Oberfläche absichtlich keinen erfundenen Live-/Next-Status

### Kontakt- und Feedback-Ziele

Der Songwunsch-/Feedback-Bereich nutzt ausschließlich lokale Link-Erzeugung. Ziele werden zentral unter `APP_CONFIG.content.contact` gepflegt:

```js
contact: {
  email: 'radio@example.com',
  issueUrl: 'https://github.com/jackdarckart/jackdarckart/issues',
  stationUrl: 'https://laut.fm/jackdarckart'
}
```

- Ohne `email` bleibt der E-Mail-Button deaktiviert und der UI-Hinweis verweist ehrlich auf GitHub Issues.
- Es werden keine Formulardaten gespeichert oder an externe Formdienste gesendet.

### Lokale Browser-Funktionen

- **Sleep-Timer:** Optionen `aus`, `15`, `30`, `60` Minuten sowie benutzerdefiniert `1–480` Minuten. Beim manuellen Stop wird der aktive Timer zurückgesetzt. Die Logik läuft ausschließlich lokal im aktiven Browserfenster.
- **Tastaturkürzel:** `Leertaste` Play/Pause, `M` Stumm, `↑/↓` Lautstärke, `S` Teilen, `T` nach oben. Aktiv nur außerhalb von `input`, `textarea`, `select`, `button`, `a` und `contenteditable`; mobile Nutzung erfolgt weiter über sichtbare Buttons.
- **Favoriten:** aktuelle Titel werden ausschließlich lokal via `localStorage` gespeichert; bei blockiertem Storage bleibt die Oberfläche funktionsfähig und meldet den Fehler defensiv. Beim Löschen von Browserdaten verschwindet die Liste wieder.

### Theme

Die Theme-Präferenz wird als `dark`, `light` oder `auto` in `localStorage` gespeichert. Wenn `localStorage` blockiert ist, fällt die Seite defensiv auf den Standard zurück und bleibt funktionsfähig.

## PWA / Offline

Die Seite enthält nun:

- `manifest.webmanifest`
- Service-Worker-Registrierung in `app.js`
- `sw.js` mit Cache nur für statische App-Dateien
- Installationshinweis per `beforeinstallprompt`, nur wenn verfügbar

Der Service Worker cached **nicht** den Live-Audiostream. Offline wird stattdessen die statische App-Shell aus dem Cache bereitgestellt.

### PWA-Test

1. Seite lokal oder auf GitHub Pages über HTTPS öffnen
2. DevTools → **Application** prüfen:
   - Manifest vorhanden
   - Service Worker registriert
   - Icons werden erkannt
3. Falls unterstützt, Installationshinweis auslösen und `App installieren` testen
4. Offline-Modus in DevTools aktivieren und Seite neu laden
5. Prüfen, dass die Oberfläche aus dem Cache lädt, der Audiostream aber nicht künstlich aus einem Cache bedient wird

## Sicherheitsmaßnahmen

- restriktive Meta-Content-Security-Policy in `index.html`
- keine ausführbaren Inline-Skripte; einziges Inline-Script-Element ist JSON-LD für strukturierte Daten
- keine externen Bibliotheken, keine Tracker, keine Analytics
- externe Ressourcen standardmäßig auf die Website selbst und den laut.fm-Stream begrenzt
- `referrer`-Policy über Meta-Tag gesetzt
- externe Links mit `target="_blank"` sowie `rel="noopener noreferrer"`
- keine automatische Audiowiedergabe beim Laden
- klarer Player-Status für bereit, lädt, spielt, pausiert, Browser-Blockierung und Fehler
- sichtbare Browser-/Verbindungsdiagnose und Auto-Reconnect-Hinweise nach echter Nutzeraktion
- Lautstärke-, Mute- und Theme-Einstellungen werden defensiv aus `localStorage` gelesen
- lokale Favoriten werden defensiv aus `localStorage` gelesen und nur im Browser des Nutzers gespeichert
- keine unvalidierte HTML-Injektion: DOM-Updates laufen über `textContent`, Attribute und bekannte Elemente
- Service Worker cached nur eigene statische App-Ressourcen, nicht den Livestream

## Bekannte Einschränkungen

- GitHub Pages für statische Dateien erlaubt keine frei konfigurierbaren HTTP-Response-Header. Deshalb wird die CSP nur als **Meta-CSP** gesetzt. Das ist besser als keine CSP, aber schwächer als echte Server-Header.
- HSTS, `X-Frame-Options`, `Permissions-Policy` und ähnliche Header lassen sich über GitHub Pages bzw. eine Custom Domain nur eingeschränkt oder gar nicht direkt aus diesem Repository steuern.
- Der Audiostream kommt von `https://jackdarckart.stream.laut.fm/jackdarckart`. Wenn laut.fm nicht erreichbar ist, kann die Website nur auf die offizielle laut.fm-Seite verweisen.
- Bei restriktiven Browser-Richtlinien (vor allem mobil/Safari) muss der Start weiter direkt über die sichtbare Nutzeraktion **Stream starten** oder **Erneut versuchen** erfolgen.
- Now-Playing und Historie bleiben ohne konfigurierte Quelle bewusst im Fallback-Zustand.
- Der Installationshinweis hängt vom Browser ab und erscheint nicht auf jedem Gerät.

## Sicherheitsmeldungen

Für diese statische Website ist keine separate `security.txt` mit verifizierter Kontaktadresse hinterlegt. Bitte melde Sicherheitsprobleme über die vorhandenen Wege im Repository, zum Beispiel über:

- GitHub Issues: <https://github.com/jackdarckart/jackdarckart/issues>
- Pull Requests gegen `main`

## Prüfungen

Es gibt im Repository derzeit keine installierte Test- oder Lint-Infrastruktur. Für Änderungen an der statischen Seite wurden daher gezielte lokale Prüfungen verwendet:

- JavaScript-Syntaxprüfung mit `node --check app.js`
- JavaScript-Syntaxprüfung mit `node --check sw.js`
- schlanker Regressionstest mit `node tests/app.test.js`
- HTML/CSS/JS-Manuelltest über einen lokalen statischen Server
- manuelle Prüfung von Sleep-Timer, Tastaturkürzeln, Favoriten, Sendeplan-Status und Songwunsch-/Feedback-Aktionen
- PWA-Prüfung über Browser-DevTools (Manifest, Service Worker, Offline-Cache)
- Wiedergabe-Flows manuell prüfen: Start, Pause, Mute, Lautstärke, Browser-Blockierung, Retry, Pufferung und Sticky-Quick-Access
- Offline-/Online-Wechsel manuell prüfen: Hinweisbanner, Recovery-Retry und statische Offline-Oberfläche
- Mobile/Tablet/Desktop-Layout mit Fokus auf Navigation, Player-Status, Historie, Empty States und zusätzliche Inhaltssektionen prüfen
- GitHub-Pages-Verhalten mit vorhandener Custom Domain `stream-musik.space` verifizieren

## Realistische Testhinweise

1. **Desktop (Chrome/Firefox/Safari):**
   - Seite laden
   - `Stream starten` klicken
   - Pause, Mute, Lautstärke, Sleep-Timer und Teilen testen
   - Tastaturkürzel außerhalb von Formularfeldern prüfen
   - Now-Playing-Favorit setzen/entfernen, sofern Metadaten verfügbar sind
   - Theme wechseln und Reload prüfen
   - Netzwerk kurz deaktivieren und Retry-/Offline-Verhalten prüfen

2. **Mobile (iPhone/Android):**
   - Start nur per Touch auslösen
   - Sticky-Quick-Access und Mobile-Menü prüfen
   - Installationshinweis / Homescreen-Verhalten prüfen
   - Browser-Blockierung bzw. erneute Freigabe testen

3. **GitHub Pages / Live-Domain:**
   - Deployment auf `https://stream-musik.space/` öffnen
   - Externe Links, Meta-CSP, CNAME, Manifest und Direktstream-Link kontrollieren
   - Service Worker aktualisieren und Offline-Fallback testen

4. **Mit echter Now-Playing-Quelle:**
   - API-Endpunkt in `app.js` eintragen
   - `connect-src` in der CSP anpassen, falls externe Domain nötig ist
   - prüfen, dass Titel, Interpret, Historie, Favoriten-Button, Media Session und Share-Text korrekt aktualisiert werden

5. **Mit gepflegtem Sendeplan / Feedback-Zielen:**
   - `APP_CONFIG.content.schedule.entries` mit verifizierten Daten pflegen
   - prüfen, dass „Jetzt live“/„Als Nächstes“ in deutscher Darstellung korrekt berechnet werden
   - optionale `contact.email` hinterlegen und E-Mail-/Issue-Flows mit validierten Eingaben testen
