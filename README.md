# stream-musik.space

Statische GitHub-Pages-Website für das Webradio **jackdarckart** auf laut.fm.

## Struktur

- `index.html` – semantische Startseite mit Meta-Tags und Player-Markup
- `styles.css` – responsives Layout und visuelles Design
- `app.js` – Navigation, Player-Logik, Share-Funktion und defensive Browser-APIs
- `CNAME` – Custom Domain `stream-musik.space`

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
- externe Ressourcen auf die Website selbst und den laut.fm-Stream begrenzt
- `referrer`-Policy über Meta-Tag gesetzt
- externe Links mit `target="_blank"` sowie `rel="noopener noreferrer"`
- keine automatische Audiowiedergabe beim Laden
- Lautstärke- und Mute-Einstellungen werden defensiv aus `localStorage` gelesen
- keine unvalidierte HTML-Injektion: DOM-Updates laufen über `textContent`, Attribute und bekannte Elemente

## Bekannte Einschränkungen

- GitHub Pages für statische Dateien erlaubt keine frei konfigurierbaren HTTP-Response-Header. Deshalb wird die CSP nur als **Meta-CSP** gesetzt. Das ist besser als keine CSP, aber schwächer als echte Server-Header.
- HSTS, `X-Frame-Options`, `Permissions-Policy` und ähnliche Header lassen sich über GitHub Pages bzw. eine Custom Domain nur eingeschränkt oder gar nicht direkt aus diesem Repository steuern.
- Der Audiostream kommt von `https://stream.laut.fm/jackdarckart`. Wenn laut.fm nicht erreichbar ist, kann die Website nur auf die offizielle laut.fm-Seite verweisen.
- Es wird bewusst **kein Service Worker** eingesetzt, um veraltete Caches und unnötige Offline-Komplexität zu vermeiden.
- Es werden bewusst keine angeblich aktuellen Titel- oder Sendeplandaten angezeigt, solange keine verlässlich eingebundene Quelle vorhanden ist.

## Sicherheitsmeldungen

Für diese statische Website ist keine separate `security.txt` mit verifizierter Kontaktadresse hinterlegt. Bitte melde Sicherheitsprobleme über die vorhandenen Wege im Repository, zum Beispiel über:

- GitHub Issues: <https://github.com/jackdarckart/jackdarckart/issues>
- Pull Requests gegen `main`

## Prüfungen

Es gibt im Repository derzeit keine installierte Test- oder Lint-Infrastruktur. Für Änderungen an der statischen Seite wurden daher gezielte lokale Prüfungen verwendet, zum Beispiel:

- JavaScript-Syntaxprüfung mit `node --check app.js`
- HTML/CSS/JS-Manuelltest über einen lokalen statischen Server
