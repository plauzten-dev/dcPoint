# dcPoint

Schnelle, selbst hostbare Chat- und Community-App mit Servern, Kanälen, Rollen und Echtzeit-Gateway.
Desktop-Client auf Basis von **Tauri 2**, Backend in **Rust (Axum)**, Frontend in **React + TypeScript**.

> Status: **Phase 1** abgeschlossen (Auth inkl. 2FA, Layout, Server, Kategorien, Kanäle, Einladungen,
> Präsenz, Einstellungen). Roadmap und Architektur: [PLAN.md](PLAN.md).

## Funktionsumfang (Phase 1)

- **Accounts:** Registrierung, Login per E-Mail oder Benutzername, 2FA (TOTP, mit QR-Code),
  Passwort ändern (meldet alle anderen Sitzungen ab), Abmelden
- **Profil:** Anzeigename, Benutzername, Avatar, Banner, Bannerfarbe, Pronomen, „Über mich“,
  Status (Online / Abwesend / Bitte nicht stören / Unsichtbar), benutzerdefinierter Status mit Ablauf
- **Server:** erstellen (mit Symbol), per Einladungslink beitreten, bearbeiten, verlassen, löschen;
  Server-Reihenfolge per Drag & Drop
- **Kanäle:** Text-, Sprachkanäle und Kategorien; private Kanäle; Kategorien einklappbar;
  Kanäle und Kategorien per Drag & Drop sortieren und verschieben (inkl. Berechtigungs-Sync)
- **Berechtigungen:** Bitmasken, Rollen-Hierarchie, Overwrites pro Kanal (Backend + Client-Spiegel)
- **Einladungen:** Ablaufzeit und Nutzungslimit, Vorschau-Seite, Verwaltung in den Servereinstellungen
- **Echtzeit:** WebSocket-Gateway mit Heartbeat, Sequenznummern und **Resume mit Event-Replay**;
  Präsenz und Mitgliederliste (virtualisiert, nach Rollen/Online gruppiert)
- **UI:** vierspaltiges Layout, Dunkel/Hell, Tooltips, Kontextmenüs, Popouts, Vollbild-Einstellungen,
  Quick Switcher, Tastaturkürzel, Lazy Loading aller Modals

### Tastaturkürzel

| Kürzel | Aktion |
|---|---|
| `Strg+K` | Quick Switcher (`#` Kanäle, `*` Server) |
| `Alt+↑` / `Alt+↓` | Vorheriger / nächster Kanal |
| `Strg+Alt+↑` / `Strg+Alt+↓` | Vorheriger / nächster Server |
| `Strg+Umschalt+M` / `D` | Stummschalten / Ein-/Ausgabe deaktivieren |
| `Strg+Umschalt+N` | Server erstellen oder beitreten |
| `Strg+U` | Mitgliederliste ein-/ausblenden |
| `Strg+,` | Benutzereinstellungen |
| `Strg+/` | Liste der Tastaturkürzel |
| `Esc` | Modal, Popout oder Menü schließen |

## Schnellstart mit Docker

Voraussetzung: Docker mit Compose v2.

```bash
docker compose up --build
```

Danach:

| Dienst | URL |
|---|---|
| Web-App | http://localhost:8000 |
| API / Gateway | http://localhost:8080 |
| S3-Speicher (SeaweedFS) | http://localhost:8333 |
| LiveKit (ab Phase 4) | ws://localhost:7880 |

Für den Produktivbetrieb unbedingt `SECRET_KEY` (≥ 32 Zeichen), die S3-Zugangsdaten
(`deploy/seaweedfs-s3.json` und `docker-compose.yml`) und die
LiveKit-Schlüssel in `deploy/livekit.yaml` ändern.

### Am Handy nutzen

Handy und Rechner müssen im selben WLAN sein. Die IP-Adresse des Rechners ermitteln
(macOS: `ipconfig getifaddr en0`) und am Handy `http://<IP>:8000` öffnen. Auf schmalen
Bildschirmen schaltet dcPoint auf eine eigene Handy-Ansicht um: Kanal antippen öffnet den
Chat, ☰ oder Wischen nach rechts führt zurück, langes Drücken öffnet Kontextmenüs. Über
„Teilen → Zum Home-Bildschirm“ lässt sich die App wie eine native App starten.

## Entwicklung ohne Docker

Voraussetzungen: Rust ≥ 1.85, Node.js 22, PostgreSQL 16.

```bash
createdb dcpoint
```

Backend (führt Migrationen automatisch aus, speichert Uploads ohne S3 lokal in `./data/uploads`):

```bash
cd server && DATABASE_URL=postgres://postgres:postgres@localhost:5432/dcpoint cargo run
```

Frontend (Vite leitet `/api`, `/cdn` und `/gateway` an `localhost:8080` weiter):

```bash
cd web && npm install && npm run dev
```

Die App läuft dann unter http://localhost:5173.

### Desktop-App (Tauri 2)

Benötigt die [Tauri-Systemvoraussetzungen](https://v2.tauri.app/start/prerequisites/)
(Linux: WebKitGTK 4.1, Windows: WebView2, macOS: Xcode CLT).

```bash
cd web && npm run tauri dev
```

Für einen Release-Build muss die Server-Adresse fest einkompiliert werden:

```bash
cd web && VITE_API_URL=https://chat.example.com npm run tauri build
```

## Tests

Backend – Unit-Tests (Berechtigungen, TOTP, Tokens, Hub, Validierung) und Integrationstests gegen
PostgreSQL (jeder Test bekommt eine eigene Datenbank):

```bash
cd server && DATABASE_URL=postgres://postgres:postgres@localhost:5432/dcpoint cargo test
```

Frontend – Typprüfung und Produktions-Build:

```bash
cd web && npm run build
```

End-to-End (Playwright; startet Backend und Frontend automatisch, falls sie nicht laufen):

```bash
cd e2e && npm install && npx playwright install chromium && npm test
```

## Konfiguration (Server)

| Variable | Standard | Beschreibung |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/dcpoint` | PostgreSQL-Verbindung |
| `BIND_ADDR` | `0.0.0.0:8080` | Adresse des HTTP-Servers |
| `SECRET_KEY` | unsicherer Dev-Schlüssel | HMAC-Schlüssel für 2FA-Tickets (≥ 32 Zeichen) |
| `CORS_ORIGINS` | `http://localhost:5173,http://tauri.localhost,tauri://localhost` | Erlaubte Origins |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | – | S3-kompatibler Speicher (SeaweedFS, MinIO, AWS …); ohne `S3_ENDPOINT` lokaler Speicher |
| `UPLOAD_DIR` | `./data/uploads` | Lokaler Speicherort ohne S3 |
| `TRUST_PROXY` | `false` | `X-Real-IP` vertrauen (nur hinter Reverse Proxy) |
| `AUTH_RATE_LIMIT_PER_MIN` | `30` | Auth-Anfragen pro IP und Minute (`0` = aus) |
| `DB_MAX_CONNECTIONS` | `20` | Größe des DB-Pools |
| `WORKER_ID` | `1` | Snowflake-Worker (0–1023), pro Instanz eindeutig |

Frontend: `VITE_API_URL` (Basis-URL der API, leer = gleicher Origin) und optional `VITE_GATEWAY_URL`.

## Projektstruktur

```
server/   Rust-Backend (Axum, SQLx, WebSocket-Gateway)
web/      React-Frontend + Tauri-Desktop-Shell (src-tauri/)
e2e/      Playwright-Tests
deploy/   LiveKit-Konfiguration
```

Details zu Datenmodell, API, Gateway-Protokoll und getroffenen Annahmen stehen in [PLAN.md](PLAN.md).

## Lizenzen

Eigener Code. Icons: [Lucide](https://lucide.dev) (ISC). Schrift: Noto Sans (SIL OFL 1.1).
Name, Logo und Illustrationen sind eigene Gestaltung.
