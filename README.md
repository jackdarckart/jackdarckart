# stream-musik.space

Moderne, statische Premium-Webradio-Website für **jackdarckart** auf **laut.fm**.

## Überblick

Die Website liegt vollständig im Repository-Root und funktioniert **ohne Build-Schritt** direkt auf GitHub Pages. Sie kombiniert ein dunkles Premium-Design mit einem integrierten Live-Player für den offiziellen Stream von `jackdarckart` auf laut.fm.

## Enthaltene Funktionen

- responsives Dark-Neon-Design mit Glassmorphism und klarer Typografie
- sticky Header mit mobiler Navigation
- integrierter Webradioplayer mit Play/Pause, Lautstärke, Mute und Reconnect
- persistente Lautstärke- und Mute-Einstellungen via `localStorage`
- sichtbarer Live-/Verbindungsstatus und animierter Equalizer nur während Wiedergabe
- Share-Button via Web Share API mit Clipboard-Fallback
- optionaler Mini-Player beim Scrollen mit derselben Audioquelle
- PWA-Basis über `manifest.webmanifest`, `icon.svg` und einen vorsichtigen Service Worker
- Platzhalterseiten für `impressum.html` und `datenschutz.html`

## Player-Quelle

Der integrierte Player verwendet den offiziellen Stream:

```text
https://stream.laut.fm/jackdarckart
```

## Now Playing / Titelinformationen

Die Website versucht optional, aktuelle Titeldaten über eine öffentliche laut.fm-Quelle im Browser zu laden. **Es werden keine Titel erfunden.** Wenn die Quelle nicht zuverlässig erreichbar ist oder keine sicheren Daten liefert, zeigt die Seite stattdessen eine ehrliche Fallback-Meldung und verweist auf die offizielle laut.fm-Seite.

## Platzhalter und bewusst offene Inhalte

Die folgenden Bereiche sind absichtlich als Platzhalter markiert, bis echte und rechtlich geprüfte Angaben vorliegen:

- `impressum.html`
- `datenschutz.html`
- Betreiberangaben / Kontakt-Identität
- Social-Media-Profile
- weitergehende redaktionelle Angaben außerhalb verifizierbarer Informationen

## Lokale Vorschau

Da die Seite rein statisch ist, genügt ein einfacher lokaler Webserver. Beispiele:

### Python

```bash
cd /home/runner/work/jackdarckart/jackdarckart
python3 -m http.server 8000
```

Dann im Browser öffnen:

```text
http://localhost:8000/
```

## GitHub-Pages-Veröffentlichung

1. Repository auf GitHub öffnen.
2. Unter **Settings → Pages** als Quelle **Deploy from a branch** wählen.
3. Branch **`main`** und Ordner **`/ (root)`** auswählen.
4. Speichern und den Build von GitHub Pages abwarten.
5. Die Seite sollte anschließend unter `https://stream-musik.space/` erreichbar sein.

## Dateien

- `index.html` – Startseite mit Design, Player und JavaScript
- `manifest.webmanifest` – PWA-Metadaten
- `sw.js` – einfacher Service Worker für statische Shell-Dateien
- `icon.svg` – App-Icon / Favicon
- `impressum.html` – markierter Impressum-Platzhalter
- `datenschutz.html` – markierter Datenschutz-Platzhalter
- `CNAME` – Custom-Domain-Konfiguration für GitHub Pages
