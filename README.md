# MKSTUDIOS

MKSTUDIOS is a private gaming community built on Express, MongoDB Atlas, and a Vite 7 frontend. The current foundation includes a responsive six-section social shell, guest-readable general feed, account sessions, posts and discussion primitives, a curated games catalog, and public game communities.

## Local development

Requirements: Node.js 22.12 or newer (below 25), npm, and a MongoDB database for account and social API operations.

Create a local `.env` (never commit it) with the variables needed for the service:

| Variable | Purpose |
| --- | --- |
| `PORT` | Express port; defaults to `3000`. |
| `NODE_ENV` | Runtime mode; use `development` locally and `production` when deployed. |
| `MONGODB_URI` | MongoDB Atlas connection URI used by the application and deliberate index migration. |
| `MONGOMS_SYSTEM_BINARY` | Optional path to a local `mongod` binary for integration tests. |
| `MONGOMS_ALLOW_DOWNLOAD` | Set to `1` when intentionally downloading MongoDB 7.0.14 for in-memory integration tests. |
| `CONFIRM_USER_INDEX_MIGRATION` | Set to `yes` only when deliberately applying the reviewed user index migration. |
| `CLIENT_URL` | Optional comma-separated allowed browser origins. Defaults include local Vite origins. |
| `RENDER` | Render-provided runtime flag used for secure cookies and same-origin checks. |
| `FRONTEND_PORT` | Vite dev port; defaults to `5174`. |
| `API_PROXY_TARGET` | Optional Express URL for the Vite `/api` proxy; defaults to `http://localhost:3000`. |

Start Express and Vite together:

```powershell
npm.cmd run dev:all
```

Vite is available at `http://127.0.0.1:5174`, with `/api` proxied to Express on port `3000`. The app starts listening even if Atlas is down; `/api/health/db` reports the database state, and the server retries the connection periodically. `GET /api/health` remains available independently of MongoDB.

Useful commands:

```powershell
npm.cmd test
npm.cmd run frontend:build
npm.cmd run seed:catalog
```

The catalog seed is additive and idempotent: it upserts game records by slug and inserts community records that are not already present. It does not remove or reset data. Run it only with the intended `MONGODB_URI` configured.

The user-index migration is deliberately separate from server startup. Review the real Atlas indexes and duplicate counts first with `node scripts/migrateUserIndexes.js --dry-run`. It reports index definitions and aggregate counts only. After reviewing the plan, apply it explicitly with `CONFIRM_USER_INDEX_MIGRATION=yes node scripts/migrateUserIndexes.js --apply` (PowerShell: `$env:CONFIRM_USER_INDEX_MIGRATION='yes'; node scripts/migrateUserIndexes.js --apply`). It creates string-only partial unique indexes before dropping replaced legacy single-field unique indexes, and stops if duplicate strings or an unexpected compound index is found. It does not edit documents or drop collections. User schema auto-indexing is disabled so startup will not perform this migration implicitly.

For Atlas, use a database user scoped to the `mkstudios` database and allow the development machine’s current IP in Network Access. On Render, allow the service’s outbound IP ranges. If a database password contains reserved URI characters, percent-encode the password portion of the URI. Keep the URI only in local ignored `.env` and Render’s environment settings.

## Current API and data model

- `User`: normalized unique username, bcrypt password hash, public profile fields, genres, and game interests.
- `Session`: hashed opaque token, private session CSRF token, user reference, expiration and TTL index. Browser session cookie is httpOnly, SameSite strict, and Secure in production/Render.
- `Game`: unique slug, genres/platforms, description, accent, nullable artwork, aliases and active flag.
- `Community`: unique slug, linked game, rules, visibility, accent and member count.
- `Membership`: community/user pair with a unique compound index and owner/moderator/member role.
- `Post`: one document with a destinations array (`general`, `game`, or `community`), body, reserved media field and counters.
- `Comment`, `Reaction`, and `Repost`: persisted records with bounded comment reads and unique user/post reaction and repost indexes.

Public feed queries only select posts with an explicit `general` destination. Community-only posts use the community destination and are not returned by general feed queries. Community post creation checks membership. The current public API uses bounded pages with opaque ObjectId cursors. User-facing text is rendered with `textContent`.

User indexes are managed explicitly by `scripts/migrateUserIndexes.js`; username is unique only for strings, optional email is unique only for strings, and the `createdAt` lookup index is created if missing. The Atlas dry run performed for this task found a full unique `username_1` index, no email index, and zero user documents/duplicate groups in the selected `mkstudios` collection. The migration has not been applied. Review the dry run and apply it deliberately when ready.

The model indexes cover: `User.username` and `User.email` partial unique indexes plus `createdAt`; `Session.tokenHash` unique, `user`, and `expiresAt` TTL; `Game.slug` unique plus active/name and genre/active lookups; `Community.slug` unique plus game/active/name; `Membership.community+user` unique and user/createdAt; `Post.destinations`, author/createdAt; `Comment.post+createdAt+_id`; `Reaction.user+post` unique and post/createdAt; and `Repost.user+post` unique. Existing User indexes are not auto-created on app startup; the deliberate migration handles just the two user uniqueness indexes.

Health endpoints are `GET /api/health` (process health) and `GET /api/health/db` (MongoDB connection state; returns 503 while disconnected). Unknown `/api/*` routes use the JSON 404 response.

## Deployment on Render

For the existing single Render Web Service:

```text
Build Command: npm install && npm run frontend:build
Start Command: npm start
Health Check Path: /api/health
```

Configure `MONGODB_URI` in Render’s environment settings. `PORT` and `NODE_ENV` are supplied by Render. `CLIENT_URL` is optional for a same-origin deployment and should list exact origins if a separate frontend is used. Atlas Network Access must allow the service’s outbound IPs.

The Express server serves the Vite `dist` build and API from the same service. Text-first profile/feed media fields are placeholders only; uploads are not implemented and no persistent local files are written. Cloudinary or S3-compatible object storage is the recommended future media path.

Socket.IO, direct messages, and notifications are not implemented in this version. If sockets are added, verify Render WebSocket support and use a shared Socket.IO adapter such as Redis when running multiple instances; durable messages must remain in MongoDB.

## Verification and current scope

Tests use Node’s built-in test runner and never read `.env`. Social integration tests use an in-memory MongoDB instance named `mkstudios_test`; they skip when no local MongoDB binary is available unless `MONGOMS_ALLOW_DOWNLOAD=1` is set. Other tests cover health/static hosting, username/index contracts, profile serialization, guest blocking, and destination visibility contracts.

The games catalog and community API require the idempotent seed command before lists are populated. The app now has account onboarding, profile/settings, feed interactions and pagination, ranked For You/Interests discovery, scoped community feeds, and game update groups. Friends, direct messages, and notifications remain unimplemented and are outside the authorized phases for this task.
