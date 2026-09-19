# stream-musik.space

Statische Landingpage für das Webradio **jackdarckart** auf laut.fm. Die Seite liegt bewusst direkt im Repository-Root, damit sie ohne Build-Schritt über GitHub Pages veröffentlicht werden kann.

## Vorschau lokal

Da keine Build-Tools nötig sind, reicht ein einfacher statischer Server im Repository-Root:

```bash
python3 -m http.server 8000
```

Danach ist die Vorschau unter `http://localhost:8000/` erreichbar.

## Veröffentlichung mit GitHub Pages

1. Repository-Inhalt auf den veröffentlichten Branch bringen.
2. In GitHub Pages den Root des Branches als Quelle verwenden.
3. Die Datei `CNAME` enthält bereits die Custom Domain `stream-musik.space`.
4. Nach dem Deployment ist die Seite unter `https://stream-musik.space/` erreichbar.
