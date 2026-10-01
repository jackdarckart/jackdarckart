# Cloudflare-Backend-Starter (Workers + D1 + KV)

Wiederverwendbares, produktionsnahes Integrationspaket für künftige Projekte: ein
serverautoritatives API-Backend auf Cloudflare Workers mit D1 (Accounts, Spielstand,
Leaderboard, Converter-Studio-Presets) und KV (Sessions). Das Paket ist eigenständig – die bestehende Website
und `server/quantum-vault.js` bleiben unverändert nutzbar.

```
cloudflare/
├── migrations/0001_init.sql   D1-Schema (users, vault_state, leaderboard, optional sessions)
├── migrations/0002_studio_presets.sql  D1-Tabelle für Converter-Studio-Presets
├── src/worker.js              Worker mit vollständiger API-Oberfläche
├── package.json               nur `"type": "module"`, keine Laufzeitabhängigkeiten
└── wrangler.toml              Template mit Platzhaltern (keine Secrets)
```

## API-Oberfläche

Alle Routen liegen unter dem Präfix `/api/quantum-vault`:

| Methode | Route          | Zweck                                                      |
| ------- | -------------- | ---------------------------------------------------------- |
| `GET`   | `/health`      | Readiness-Check ohne Geheimnisse                             |
| `POST`  | `/register`    | Account anlegen, Session-Cookie setzen                       |
| `POST`  | `/login`       | Anmeldung, Session-Cookie setzen                             |
| `POST`  | `/logout`      | Session in KV löschen, Cookie invalidieren                   |
| `GET`   | `/session`     | aktuellen Account inkl. Spielstand laden                     |
| `POST`  | `/action`      | Spielaktion serverseitig berechnen (`harvest`, `forge`, `upgrade`, `tree`, `jukebox`) |
| `POST`  | `/save`        | Save-Zähler erhöhen (`kind`: `manual` oder `auto`)           |
| `GET`   | `/leaderboard` | Top 25 nach Vibe-Score                                       |
| `GET`   | `/studio-preset` | Gespeichertes Converter-Studio-Preset des Accounts laden (`preset` ist `null`, falls keines existiert) |
| `POST`  | `/studio-preset` | Studio-Preset speichern (`{ "preset": { "settings": {…}, "enhance": {…} } }`) |

Fehlerantworten sind immer JSON mit stabilem Code und Klartextmeldung:

```json
{ "code": "INVALID_CREDENTIALS", "error": "Invalid handle or password." }
```

Codes: `HANDLE_INVALID`, `PASSWORD_INVALID`, `HANDLE_TAKEN`, `INVALID_CREDENTIALS`,
`SESSION_REQUIRED`, `CROSS_ORIGIN`, `INVALID_JSON`, `BODY_TOO_LARGE`, `INVALID_SAVE_KIND`,
`UNKNOWN_ACTION`, `UNKNOWN_UPGRADE`, `UNKNOWN_NODE`, `UNKNOWN_TRACK`, `ACTION_COOLDOWN`,
`INSUFFICIENT_RESOURCES`, `UPGRADE_MAXED`, `NODE_LOCKED`, `NODE_UNLOCKED`, `TRACK_DECODED`,
`NOT_FOUND`, `DB_UNAVAILABLE`, `SESSIONS_UNAVAILABLE`, `VAULT_STATE_MISSING`,
`VAULT_STATE_INVALID`, `STUDIO_PRESET_INVALID`, `INTERNAL_ERROR`.

### Converter-Studio-Presets

Das Converter-Studio (`converter.html`) nutzt denselben Account und dieselbe Session für den
Preset-Sync. Der Worker übernimmt ausschließlich die Regler `eqLow`, `eqMid`, `eqHigh`,
`compThreshold`, `compRatio`, `limiterCeiling`, `stereoWidth`, `targetLufs` (serverseitig auf
Reglerbereich und Schrittweite begrenzt) sowie `enhance.auto` und `enhance.strength`
(`subtle`, `gentle`, `balanced`, `strong`, `intense`, `maximum`). Unbekannte Felder werden verworfen; Audiodaten werden weder
angenommen noch gespeichert. Aktivierung im Frontend über
`window.__JACKDARCKART_CONFIG__.converter.cloudSync.apiBase`.

## Sicherheitsarchitektur

- **Serverautoritativ**: Aus dem Request werden ausschließlich `action` und die zugehörige
  ID (`upgrade`, `node`, `track`) bzw. `kind` gelesen. Mitgeschickte `userId`, `vibeScore`,
  `state`-Objekte o. Ä. werden ignoriert; alle Beträge stammen aus dem gespeicherten Zustand.
- **Sessions**: zufälliges Token (`crypto.randomUUID()` + 24 Zufallsbytes) in KV, referenziert
  über ein `HttpOnly; Secure; SameSite=None`-Cookie mit `Path=/api/quantum-vault` und 7 Tagen TTL.
  Der Browser erhält nie Account-IDs oder Tokens im Response-Body.
- **Kein localStorage als Datenquelle**: Account- und Spielstand gelten nur serverseitig;
  Clients müssen `credentials: "include"` nutzen und den Zustand aus `/session` beziehen.
- **CORS**: `ALLOWED_ORIGINS` ist eine kommaseparierte Allowlist. Nur gelistete Origins erhalten
  `Access-Control-Allow-Origin` + `Access-Control-Allow-Credentials: true` (inkl. `Vary: Origin`).
  Schreibende Requests ohne erlaubten `Origin`-Header werden mit `403 CROSS_ORIGIN` abgelehnt –
  das ersetzt bei `SameSite=None` den CSRF-Schutz.
- **Eingabevalidierung**: Handle `^[A-Za-z0-9_-]{3,20}$`, Passwort 10–128 Zeichen,
  Body maximal 16 KiB, Body muss ein JSON-Objekt sein. Harvest hat einen Cooldown
  (`HARVEST_COOLDOWN_MS`, Standard 700 ms) gegen Auto-Clicker.
- **Header**: `Cache-Control: no-store, private` für private Antworten,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.
- **Keine Secrets im Repository**: `wrangler.toml` enthält nur Platzhalter; echte Werte kommen
  aus Cloudflare Secrets/Vars.

## Worker-Kompatibilität (kein Node)

Der Worker nutzt ausschließlich Web-Standard-APIs (`fetch`, `Request`/`Response`, `URL`,
`TextEncoder`, `crypto.subtle`, `btoa`) – keine Node-Module wie `node:crypto` oder `node:fs`.

Da `crypto.scrypt` in Workers nicht verfügbar ist, wird das Passwort mit **PBKDF2-SHA-256,
210 000 Iterationen, 256 Bit** über WebCrypto abgeleitet, mit einem accountspezifischen
16-Byte-Salt und optionalem serverseitigem `PEPPER`. Der Vergleich erfolgt in konstanter Zeit.
Wer zwingend scrypt/Argon2 braucht, kann die KDF in `hashPassword()` ersetzen (z. B. WASM-Build)
und dabei die Spaltenwerte migrieren.

## Persistenzmodell

- `users` – `id` (UUID), `handle`, `handle_key` (kleingeschrieben, `UNIQUE`), `pw_hash`, `pw_salt`, `created_at`
- `vault_state` – `user_id` (PK), `state_json`, `updated_at`
- `leaderboard` – `user_id` (PK), `handle`, `vibe_score`, `updated_at`
- `studio_presets` – `user_id` (PK), `preset_json`, `updated_at` (nur Reglerwerte und Auto-Enhance-Einstellungen)
- `sessions` – optionale D1-Alternative zu KV (`token`, `user_id`, `created_at`, `expires_at`).
  Wird sie genutzt, ersetzen `SELECT`/`INSERT`/`DELETE` auf dieser Tabelle die KV-Aufrufe
  (`issueSession`, `authenticate`, `/logout`) und ein Cron-Trigger räumt abgelaufene Zeilen auf.
  KV ist der Standard, weil es Ablauf (`expirationTtl`) automatisch erledigt und global liest.

**Schlüssel- und Datenhaltung**

- `PEPPER` ist ein reines Cloudflare-Secret; Rotation macht bestehende Passwort-Hashes ungültig,
  daher nur zusammen mit einem Re-Hash-Pfad beim nächsten Login rotieren.
- Session-Tokens sind kurzlebig (7 Tage TTL) und werden bei `/logout` sofort gelöscht.
- `vault_state.state_json` enthält nur Spielfortschritt, keine personenbezogenen Daten.
- Account-Löschung: `DELETE FROM users WHERE handle_key = ?` entfernt per `ON DELETE CASCADE`
  auch Spielstand, Leaderboard-Eintrag, Studio-Presets und D1-Sessions; KV-Sessions laufen über die TTL aus.
- Backups: `wrangler d1 export quantum-vault-db --remote --output backup.sql` (Backups
  verschlüsselt und außerhalb des Repositories ablegen).

## Setup und Deployment

```bash
cd cloudflare

# 1) Anmelden
npx wrangler login

# 2) D1-Datenbank anlegen und die ausgegebene database_id in wrangler.toml eintragen
npx wrangler d1 create quantum-vault-db

# 3) KV-Namespace für Sessions anlegen und die id in wrangler.toml eintragen
npx wrangler kv namespace create SESSIONS

# 4) Migration anwenden (lokal und remote)
npx wrangler d1 migrations apply quantum-vault-db --local
npx wrangler d1 migrations apply quantum-vault-db --remote

# 5) Secrets setzen (niemals in wrangler.toml committen)
npx wrangler secret put PEPPER

# 6) Lokale Entwicklung
npx wrangler dev
curl http://127.0.0.1:8787/api/quantum-vault/health

# 7) Deployment
npx wrangler deploy
```

### Subdomain binden (z. B. `vault.stream-musik.space`)

1. Zone `stream-musik.space` in Cloudflare verwalten (Nameserver umstellen).
2. DNS-Eintrag `vault` als **proxied** (orange Wolke) anlegen, z. B. `AAAA vault 100::`.
3. In `wrangler.toml` den `[[routes]]`-Block aktivieren:
   `pattern = "vault.stream-musik.space/api/*"`, `zone_name = "stream-musik.space"`.
4. `npx wrangler deploy` ausführen.
5. `ALLOWED_ORIGINS` auf die Frontend-Origin(s) setzen, z. B. `https://stream-musik.space`.
6. Prüfen: `curl https://vault.stream-musik.space/api/quantum-vault/health`.

### Frontend-Anbindung

```js
const API_BASE = 'https://vault.stream-musik.space/api/quantum-vault';

const response = await fetch(`${API_BASE}/session`, { credentials: 'include' });
```

Jeder Request braucht `credentials: 'include'`, damit das HttpOnly-Session-Cookie mitgeht.

## Integrations-Checkliste für künftige Projekte

- [ ] `cloudflare/` kopieren, `name`, `database_name` und API-Präfix (`API_PREFIX`) anpassen
- [ ] `ALLOWED_ORIGINS` auf die realen Frontend-Origins setzen (keine Wildcards)
- [ ] D1 erstellen, IDs eintragen, Migration lokal und remote anwenden
- [ ] KV-Namespace erstellen und binden (oder auf die D1-`sessions`-Tabelle umstellen)
- [ ] Secrets per `wrangler secret put` setzen, nie committen
- [ ] Domänenlogik in `applyAction()` ersetzen – Regeln bleiben serverseitig
- [ ] Fehlercodes im Frontend übersetzen und `credentials: 'include'` verwenden
- [ ] `node tests/cloudflare-worker.test.js` an die neue Logik anpassen und grün halten
- [ ] Health-Check nach dem Deploy prüfen und Alarmierung/Logs aktivieren

## Tests

`tests/cloudflare-worker.test.js` prüft den Worker mit In-Memory-Doubles für D1 und KV
(ohne Netzwerk, ohne zusätzliche Abhängigkeiten):

```bash
npm run check
npm test
```
