# stream-musik.space

Statische GitHub-Pages-Website für das Webradio **jackdarckart** auf laut.fm.

## Überblick

Die Website bleibt bewusst eine kleine, statische Landingpage ohne Build-Pipeline und ohne externe Frontend-Abhängigkeiten. Sie bündelt den offiziellen laut.fm-Stream in einem browserfreundlichen Direktplayer und ergänzt ihn um:

- direkte Browser-Wiedergabe nach echter Nutzeraktion
- klarere Status-, Fehler- und Retry-Hinweise
- Sticky-Quick-Access zum Player beim Scrollen
- Now-Playing-Fläche mit dokumentierter laut.fm-Quelle (`api.laut.fm/.../current_song`) und ehrlichem „nicht verfügbar“-Fallback
- Share-/Link-Kopier-Funktion per nativer Browser-API mit Fallback
- sichtbare Diagnose- und Fallback-Wege für Browser- und Verbindungsprobleme
- reale FAQ-, Kontakt-, Sicherheits- und Datenschutzhinweise
- Impressum-Vorlage, security.txt und PWA-Basis ohne Build-Schritt
- kontraststarkes, responsives Layout für Mobile, Tablet und Desktop

## Struktur

- `index.html` – semantische Startseite mit Meta-Tags, Direktplayer-Markup, Diagnoseflächen und Inhaltssektionen
- `styles.css` – responsives Layout, Sticky-Elemente, technische Player-UI, FAQ-Design und visuelle Gestaltung
- `app.js` – Navigation, Player-Logik mit Retry-/Reconnect-Verhalten, Statusdiagnose, Share-Funktion und defensive Browser-APIs
- `CNAME` – Custom Domain `stream-musik.space`
- `tests/app.test.js` – schlanker Node-basierter Regressionstest für zentrale Player-Flows und defensive Initialisierung
- `manifest.webmanifest` – PWA-Basis für installierbare Darstellung ohne Service Worker
- `assets/*.svg` und `assets/icon-*.png` – App-/Social-Icons für Browser, PWA-Installationen und Social-Preview
- `.well-known/security.txt` – standardisierter Kontaktweg für Security-Meldungen
- `.github/workflows/validate-static-player.yml` – CI-Workflow für Syntax und Regressionstests

Die Website benötigt **keinen Build-Schritt** und wird direkt aus dem Repository-Root veröffentlicht.

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

## Sicherheitsmaßnahmen

- restriktive Meta-Content-Security-Policy in `index.html`
- keine Inline-Skripte, keine externen Bibliotheken, keine Tracker
- externe Ressourcen auf die Website selbst, den laut.fm-Stream und die dokumentierte Live-Metadatenquelle (`api.laut.fm`) begrenzt
- `referrer`-Policy über Meta-Tag gesetzt
- externe Links mit `target="_blank"` sowie `rel="noopener noreferrer"`
- keine automatische Audiowiedergabe beim Laden
- klarer Player-Status für bereit, lädt, spielt, pausiert, Browser-Blockierung und Fehler
- sichtbare Browser-/Verbindungsdiagnose und Auto-Reconnect-Hinweise nach echter Nutzeraktion
- Lautstärke- und Mute-Einstellungen werden defensiv aus `localStorage` gelesen
- keine unvalidierte HTML-Injektion: DOM-Updates laufen über `textContent`, Attribute und bekannte Elemente

## Bekannte Einschränkungen

- GitHub Pages für statische Dateien erlaubt keine frei konfigurierbaren HTTP-Response-Header. Deshalb wird die CSP nur als **Meta-CSP** gesetzt. Das ist besser als keine CSP, aber schwächer als echte Server-Header.
- HSTS, `X-Frame-Options`, `Permissions-Policy` und ähnliche Header lassen sich über GitHub Pages bzw. eine Custom Domain nur eingeschränkt oder gar nicht direkt aus diesem Repository steuern.
- Der Audiostream kommt von `https://jackdarckart.stream.laut.fm/jackdarckart`. Wenn laut.fm nicht erreichbar ist, kann die Website nur auf die offizielle laut.fm-Seite verweisen.
- Bei restriktiven Browser-Richtlinien (vor allem mobil/Safari) muss der Start weiter direkt über die sichtbare Nutzeraktion **Stream starten** oder **Erneut versuchen** erfolgen.
- Es wird bewusst **kein Service Worker** eingesetzt, um veraltete Caches und unnötige Offline-Komplexität zu vermeiden.
- Die Now-Playing-Anzeige nutzt nur die dokumentierte Quelle `https://api.laut.fm/station/jackdarckart/current_song`; bei CORS-/Netzwerkproblemen wird bewusst ein transparenter „nicht verfügbar“-Fallback angezeigt.

## Sicherheitsmeldungen

Sicherheitsmeldungen sind über `/.well-known/security.txt` dokumentiert. Verifizierte Kontaktwege:

- GitHub Issues: <https://github.com/jackdarckart/jackdarckart/issues>
- GitHub Security Advisories: <https://github.com/jackdarckart/jackdarckart/security/advisories/new>

## Prüfungen

Es gibt im Repository derzeit keine installierte Test- oder Lint-Infrastruktur. Für Änderungen an der statischen Seite wurden daher gezielte lokale Prüfungen verwendet, zum Beispiel:

- JavaScript-Syntaxprüfung mit `node --check app.js`
- schlanker Regressionstest mit `node tests/app.test.js`
- CI-Workflow mit denselben Befehlen in GitHub Actions (`Validate static player`)
- HTML/CSS/JS-Manuelltest über einen lokalen statischen Server
- Wiedergabe-Flows manuell prüfen: Start, Pause, Stumm, Lautstärke, Browser-Blockierung, Retry, Pufferung und Sticky-Quick-Access
- Mobile/Tablet/Desktop-Layout mit Fokus auf Navigation, Player-Status und FAQ-Sektionen prüfen
- GitHub-Pages-Verhalten mit vorhandener Custom Domain `stream-musik.space` verifizieren

## Realistische Testhinweise

Für die Browserprüfung bieten sich folgende Szenarien an:

1. **Desktop (Chrome/Firefox/Safari):**
   - Seite laden
   - `Stream starten` klicken
   - Pause, Mute, Lautstärke und Teilen testen
   - Netzwerk kurz deaktivieren und Retry-Verhalten prüfen

2. **Mobile (iPhone/Android):**
   - Start nur per Touch auslösen
   - Sticky-Quick-Access und Mobile-Menü prüfen
   - Browser-Blockierung bzw. erneute Freigabe testen

3. **GitHub Pages / Live-Domain:**
   - Deployment auf `https://stream-musik.space/` öffnen
   - Externe Links, Meta-CSP, CNAME und Direktstream-Link kontrollieren
