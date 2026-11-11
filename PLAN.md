# dcPoint – Architekturplan

dcPoint ist eine Chat- und Community-App, deren Aufbau und Bedienung sich an etablierten
Community-Chats orientiert. Name, Logo und alle Grafiken sind eigene Werke; Icons stammen aus
[Lucide](https://lucide.dev) (ISC-Lizenz).

## Ordnerstruktur

```
dcPoint/
├── server/                 Rust-Backend (Axum, SQLx, Tokio)
│   ├── migrations/         SQL-Migrationen (beim Start automatisch ausgeführt)
│   ├── src/
│   │   ├── main.rs         Bootstrap (Config, DB-Pool, Migrationen, HTTP-Server)
│   │   ├── lib.rs          Router-Aufbau (auch von Integrationstests genutzt)
│   │   ├── auth/           Passwort-Hashing (Argon2id), Session-Tokens, TOTP (RFC 6238), Extractor
│   │   ├── gateway/        WebSocket-Gateway: Hub (Sessions, Fan-out, Replay-Puffer), Verbindung
│   │   ├── routes/         REST-Handler (auth, users, guilds, channels, invites, cdn)
│   │   ├── permissions.rs  Berechtigungs-Bitmasken, Overwrites, Hierarchie (rein, getestet)
│   │   ├── snowflake.rs    64-bit-IDs (Zeitstempel | Worker | Sequenz), als String serialisiert
│   │   └── storage.rs      S3-kompatibel (SeaweedFS/MinIO) bzw. lokales Dateisystem
│   └── tests/              Integrationstests gegen echte PostgreSQL (sqlx::test)
├── web/                    Frontend (React 19, TypeScript, Vite, Tailwind 4, Zustand, TanStack)
│   ├── src/
│   │   ├── api/            REST-Client, Typen, Gateway-Client (Heartbeat, Resume, Backoff)
│   │   ├── stores/         Zustand-Stores (Session, Guilds/Channels, Presence, UI)
│   │   ├── components/     Layout (GuildBar, ChannelSidebar, Chat, MemberList), UI-Primitives
│   │   ├── modals/         Modals (lazy geladen), Einstellungen als Vollbild-Modals
│   │   └── lib/            Permissions (Spiegel des Backends), Shortcuts, Bild-Utilities
│   └── src-tauri/          Tauri-2-Desktop-Shell
├── e2e/                    Playwright-E2E-Tests der Kernabläufe
├── deploy/                 Nginx-Konfiguration, LiveKit-Konfiguration
└── docker-compose.yml      Postgres, Redis, SeaweedFS (S3), LiveKit, Server, Web
```

## Datenmodell (PostgreSQL)

Alle IDs sind Snowflakes (`BIGINT`, Epoch 2025-01-01), in JSON immer als String.

| Tabelle | Zweck |
|---|---|
| `users` | Account, Profil (Anzeigename, Avatar, Banner, Bio, Pronomen, Akzentfarbe), Status, Custom Status, TOTP |
| `sessions` | Login-Sessions; nur SHA-256 des Token-Secrets wird gespeichert |
| `guilds` | Server (Name, Icon, Besitzer) |
| `roles` | Rollen (Farbe, Position, Bitmaske, hoist). `@everyone` hat `id = guild_id` |
| `members`, `member_roles` | Mitgliedschaft, Nickname, Timeout, Rollen-Zuordnung |
| `channels` | Kanäle (Typ 0 Text, 2 Sprache, 4 Kategorie; 1/3 DMs ab Phase 3), Position, `parent_id` |
| `permission_overwrites` | Overwrites pro Kanal (Rolle oder Mitglied, allow/deny) |
| `invites` | Einladungscodes mit Ablauf und Nutzungslimit |
| Phase 2+ | `messages`, `attachments`, `reactions`, `read_states`, `pins`, `threads`, `emojis` |
| Phase 3+ | `relationships` (Freunde/Blockiert), `dm_recipients` |
| Phase 5 | `bans`, `audit_log`, Volltextindex (`tsvector`) auf `messages` |

## Berechtigungen

Bitmasken wie üblich (u. a. `VIEW_CHANNEL = 1<<10`, `SEND_MESSAGES = 1<<11`, `ADMINISTRATOR = 1<<3`).
Berechnung (`server/src/permissions.rs`, gespiegelt in `web/src/lib/permissions.ts`):

1. Besitzer → alle Rechte. Sonst `@everyone | alle Rollen des Mitglieds`; `ADMINISTRATOR` → alle Rechte.
2. Kanal: `@everyone`-Overwrite → Rollen-Overwrites (gesammelt deny, dann allow) → Mitglieds-Overwrite.
3. Ohne `VIEW_CHANNEL` → keine Rechte im Kanal. Ohne `SEND_MESSAGES` entfallen Mention-/Datei-/Embed-Rechte.
   Ohne `CONNECT` entfallen Sprach-Rechte.
4. Timeout → nur `VIEW_CHANNEL` und `READ_MESSAGE_HISTORY` (außer Besitzer/Admin).
5. Hierarchie: Aktionen auf Mitglieder/Rollen nur, wenn die höchste eigene Rolle strikt höher liegt.

## REST-API (`/api/v1`)

| Methode | Pfad | Beschreibung |
|---|---|---|
| POST | `/auth/register`, `/auth/login`, `/auth/mfa/totp`, `/auth/logout` | Auth, Login mit 2FA-Ticket |
| GET/PATCH | `/users/@me` | Eigenes Profil (Avatar/Banner als Data-URI) |
| PATCH | `/users/@me/settings` | Status, Custom Status |
| POST | `/users/@me/mfa/totp/{enable,confirm,disable}` | 2FA verwalten |
| GET | `/users/{id}` | Öffentliches Profil |
| DELETE | `/users/@me/guilds/{id}` | Server verlassen |
| POST | `/guilds` | Server erstellen (mit Standard-Kategorien/-Kanälen) |
| GET/PATCH/DELETE | `/guilds/{id}` | Server lesen/bearbeiten/löschen |
| GET | `/guilds/{id}/members` | Mitgliederliste |
| POST/PATCH | `/guilds/{id}/channels` | Kanal erstellen / Reihenfolge + Kategorie per Drag & Drop |
| GET | `/guilds/{id}/invites` | Einladungen verwalten |
| PATCH/DELETE | `/channels/{id}` | Kanal bearbeiten/löschen |
| POST | `/channels/{id}/invites` | Einladung erstellen |
| GET/POST/DELETE | `/invites/{code}` | Einladung ansehen / annehmen / löschen |
| GET | `/cdn/{avatars,banners,icons}/{id}/{hash}` | Bilder (immutable, lange gecacht) |

Fehlerformat: `{ "code": "MISSING_PERMISSIONS", "message": "...", "errors": { "feld": "CODE" } }`.
Das Frontend übersetzt Codes ins Deutsche.

## Gateway (`/gateway`, WebSocket, JSON)

| Op | Name | Richtung |
|---|---|---|
| 0 | DISPATCH (`t`, `s`, `d`) | Server → Client |
| 1 | HEARTBEAT | Client → Server |
| 2 | IDENTIFY `{token}` | Client → Server |
| 6 | RESUME `{token, session_id, seq}` | Client → Server |
| 7 | RECONNECT | Server → Client |
| 9 | INVALID_SESSION | Server → Client |
| 10 | HELLO `{heartbeat_interval}` | Server → Client |
| 11 | HEARTBEAT_ACK | Server → Client |

Dispatch-Events Phase 1: `READY`, `RESUMED`, `GUILD_CREATE/UPDATE/DELETE`, `CHANNEL_CREATE/UPDATE/DELETE`,
`GUILD_MEMBER_ADD/REMOVE`, `GUILD_ROLE_CREATE/UPDATE/DELETE`, `PRESENCE_UPDATE`, `USER_UPDATE`.
Ab Phase 2: `MESSAGE_CREATE/UPDATE/DELETE`, `MESSAGE_REACTION_*`, `TYPING_START`, `MESSAGE_ACK`,
`CHANNEL_PINS_UPDATE`, `THREAD_*`. Ab Phase 4: `VOICE_STATE_UPDATE`.

**Replay:** Jede Session hat eine Sequenznummer und einen Ringpuffer (2048 Events). Nach einem
Verbindungsabbruch bleibt die Session 2 Minuten erhalten; `RESUME` spielt alle Events mit `s > seq`
nach. Ist der Puffer übergelaufen, antwortet der Server mit `INVALID_SESSION` und der Client
identifiziert sich neu (vollständiger READY-Snapshot).

## Frontend-Architektur

- **Zustand** hält den Gateway-Zustand normalisiert (`guilds`, `channels`, `roles`, `users`,
  `presences`); Komponenten abonnieren mit feingranularen Selektoren → minimale Re-Renders.
- **TanStack Query** für REST-Ressourcen (Mitglieder, Einladungen, Profile); Gateway-Events
  aktualisieren den Query-Cache direkt (`setQueryData`), dadurch keine Refetches.
- **TanStack Virtual** für Mitgliederliste (Phase 1) und Nachrichtenliste (Phase 2).
- **Code-Splitting:** Einstellungen, Modals, Quick Switcher und (Phase 4) Voice werden per
  `React.lazy` geladen; Vendor-Chunks getrennt.
- **Theme:** CSS-Variablen (`--bg-*`, `--text-*`), Dunkel standardmäßig, Hell per Klasse.

## Annahmen und Entscheidungen

| # | Entscheidung | Begründung |
|---|---|---|
| A1 | Backend in **Rust (Axum 0.8)**, SQLx mit Laufzeit-Queries | Kein DB-Zugriff zur Compile-Zeit nötig, schnelle Builds in CI |
| A2 | Opake Session-Tokens (`<session>.<secret>`) statt JWT | Sofort widerrufbar (Logout, Passwortwechsel); Validierung über In-Memory-Cache (5 min) |
| A3 | TOTP selbst implementiert (RFC 6238, SHA-1, 6 Stellen, 30 s, ±1 Schritt) | Klein, mit RFC-Testvektoren getestet; Replay-Schutz über `totp_last_step` |
| A4 | Login mit 2FA liefert ein HMAC-signiertes Ticket (5 min) | Zustandslos, kein zweiter Tabelleneintrag |
| A5 | Avatare/Icons/Banner werden im Client per Canvas skaliert und als Data-URI gesendet | Kein Bild-Decoding im Server (Sicherheit, CPU); Server prüft Magic Bytes und Größe |
| A6 | Gateway-Hub im Prozess; Redis-Pub/Sub-Fan-out erst im Skalierungs-Meilenstein (mehrere Server-Instanzen) | Für selbst gehostete Ein-Server-Installationen ohne Nutzen; erfordert verteilte Präsenz. Die Fan-out-Stellen (`dispatch_*`) sind zentralisiert und werden dann zielbasiert über Redis verteilt |
| A7 | UI-Sprache Deutsch, Code und API Englisch | Zielgruppe |
| A8 | Ohne konfiguriertes S3 speichert der Server Uploads lokal (`UPLOAD_DIR`) | Entwicklung ohne Docker |
| A9 | Kanalnamen von Textkanälen werden normalisiert (klein, Leerzeichen → `-`) | Wie im Vorbild |
| A10 | Rate-Limit für Auth-Endpunkte: feste Fenster pro IP (Standard 30/min) | Brute-Force-Schutz ohne externe Abhängigkeit |
| A11 | Präsenz „offline“ sofort beim Trennen der letzten Verbindung | Einfach; Grace-Period kann ergänzt werden |
| A12 | Tauri-Build braucht WebKitGTK (Linux) bzw. WebView2 (Windows); Web-Version läuft ohne | Gleiche Codebasis |
| A14 | Link-Vorschaubilder laufen über einen HMAC-signierten Proxy des Servers | Datenschutz: Dritte sehen keine Nutzer-IPs. SSRF-Schutz: keine privaten/Loopback-Adressen, auch nicht nach DNS oder Weiterleitung |
| A15 | Anhänge haben unratbare, nicht ablaufende URLs (Token im Pfad) | Keine „toten Links“ wie bei ablaufenden CDN-URLs; HTML/SVG werden nie inline ausgeliefert |
| A16 | Keine künstlichen Limits für Einzelnutzer: 4000 Zeichen, Upload-Größe legt der Betreiber fest, eigene Emojis überall nutzbar | Abgrenzung zu Paywall-Modellen |
| A17 | Threads sind Kanäle (Typ 11) und erben die Rechte des Elternkanals | Ein Berechtigungsmodell für alles |
| A13 | S3-Speicher in docker-compose ist **SeaweedFS** statt MinIO | MinIO veröffentlicht keine Images mehr auf Docker Hub; der Server spricht generisches S3 und legt den Bucket bei Bedarf selbst an |

## Phasen

- [x] **Phase 1** – Auth (Registrierung, Login, 2FA), Profil, Status, Layout, Server, Kategorien,
      Kanäle, Drag & Drop, Einladungen, Präsenz, Mitgliederliste, Einstellungen, Shortcuts
- [x] **Phase 2** – Nachrichten (virtualisiert, gruppiert), Bearbeiten/Löschen/Antworten, Reaktionen,
      Markdown mit Syntax-Highlighting, Uploads, Link-Vorschauen, Pins, Threads, eigene Emojis,
      Typing, Unread/Mentions
- [ ] **Phase 2b – Alleinstellungsmerkmale** (siehe unten), vor Voice empfohlen
- [ ] **Phase 3** – DMs, Gruppen-DMs, Freunde, Rollenverwaltung, Kanal-Overwrites-UI
- [ ] **Phase 4** – Voice/Video/Screenshare über LiveKit
- [ ] **Phase 5** – Suche, Moderation (Kick/Bann/Timeout), Audit-Log, Benachrichtigungen, Feinschliff
- [ ] **Skalierung** – Redis-Pub/Sub-Fan-out, verteilte Präsenz, Caching der Berechtigungskontexte

## Alleinstellungsmerkmale (Recherche November 2026)

Ein reiner Klon hat keine Chance; Fluxer, Stoat u. a. kopieren bereits die Oberfläche. Die größten
offenen Probleme laut Nutzerstimmen: Ausweis-/Gesichtsprüfung samt Datenleck, Wissen geht in Chats
verloren (schlechte Suche, nicht über Google auffindbar), Werbung und Paywall. dcPoint setzt auf drei Säulen:

1. **Wissen, das bleibt:** „Als Lösung markieren“ (Flag `SOLUTION` bereits im Datenmodell) → automatische
   FAQ/Wissensdatenbank pro Server; opt-in öffentliches, indexierbares Archiv ausgewählter Kanäle;
   Volltextsuche, die Code und Versionsnummern findet (`tsvector`-Index vorhanden); „Was hab ich verpasst?“.
2. **Privatsphäre als Versprechen:** keine Ausweisprüfung, keine Werbung, kein Tracking, Bild-Proxy,
   selbst hostbar mit einem Befehl, keine Paywall für Grundfunktionen.
3. **Einfacher Umzug:** Import aus dem Discord-Datenexport und eine Brücke für die Übergangszeit.
