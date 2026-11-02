# Arcadia

**Arcadia is a social gaming network built by MKSTUDIOS**, designed to bring gamers together through personalized feeds, gaming communities, friendships, game discovery, and shared content.

The application uses Express, MongoDB Atlas, and a Vite 7 frontend. Its architecture supports guest access to public content, authenticated social interactions, persistent user accounts, community membership, and personalized content discovery.

The frontend and backend are deployed together as a single Render Web Service. MongoDB Atlas provides persistent application data, while Cloudinary provides cloud-based media storage for supported uploads.

## Core Features

Arcadia's current foundation includes:

- Responsive social interface for desktop and mobile.
- Guest-readable public content, with authentication required for protected actions.
- Account registration, login, session management, and onboarding.
- User profiles, profile settings, gaming interests, and preferred genres.
- General social feed with post creation, reactions, comments, and reposts.
- Paginated feed retrieval using cursor-based navigation.
- Personalized feed ranking and interest-based content discovery.
- Game-specific feeds and community-scoped discussions.
- Public and private community infrastructure with membership roles.
- Curated gaming catalog and game update groups.
- Profile and post media support using cloud storage.
- Friend-related functionality, including friend requests and user discovery, as part of the evolving social platform.

Arcadia's architecture is designed to support further development without prematurely splitting its application or database into multiple services.

---

## Local Development

### Requirements

- Node.js `>=22.12.0 <25`.
- npm.
- A MongoDB database for account and social API operations.
- A Cloudinary account and appropriate credentials for media-upload functionality.
- Git for version control.

### Environment Configuration

Create a local `.env` file in the project root. Never commit this file or expose its secrets in source control.

| Variable | Purpose |
|---|---|
| `PORT` | Express server port. Defaults to `3000`. |
| `NODE_ENV` | Runtime environment, normally `development` locally and `production` in deployment. |
| `MONGODB_URI` | MongoDB Atlas connection URI used by the application and deliberate index migration. |
| `MONGOMS_SYSTEM_BINARY` | Optional path to a local MongoDB binary for integration tests. |
| `MONGOMS_ALLOW_DOWNLOAD` | Set to `1` when intentionally downloading MongoDB `7.0.14` for in-memory integration tests. |
| `CONFIRM_USER_INDEX_MIGRATION` | Set to `yes` only when deliberately applying the reviewed user-index migration. |
| `CLIENT_URL` | Optional comma-separated list of permitted browser origins. Local Vite origins are included by default. |
| `RENDER` | Render-provided runtime flag used for production cookie security and same-origin checks. |
| `FRONTEND_PORT` | Vite development-server port. Defaults to `5174`. |
| `API_PROXY_TARGET` | Optional Express URL used by Vite's `/api` proxy. Defaults to `http://localhost:3000`. |
| Cloudinary configuration | Credentials and configuration required by the application's media-upload integration. Use the exact variable names expected by the current implementation. |

Cloudinary credentials and database connection strings must remain private. Configure production secrets through Render's environment settings rather than placing them in committed source files.

### Start the Application

From the project directory, run:

```powershell
npm.cmd run dev:all
```

The development environment runs the Express API and Vite frontend together.

Default local endpoints:

- Frontend: `http://127.0.0.1:5174`
- Express API: `http://localhost:3000`
- Process health: `/api/health`
- Database health: `/api/health/db`

Vite proxies `/api` requests to Express.

The server can begin listening while MongoDB Atlas is unavailable. The database health endpoint reports connection status, and the server retries its connection periodically. The general health endpoint remains available independently of MongoDB connectivity.

### Useful Commands

Run the test suite:

```powershell
npm.cmd test
```

Build the production frontend:

```powershell
npm.cmd run frontend:build
```

Seed the game catalog and associated initial community records:

```powershell
npm.cmd run seed:catalog
```

The catalog seed is additive and idempotent. It upserts game records by slug and inserts community records that do not already exist. It does not remove or reset existing data.

Run the seed command only after confirming that `MONGODB_URI` points to the intended database.

---

## Database and Index Management

Arcadia uses MongoDB Atlas as its primary persistent data store.

The current architecture keeps the main social entities in one database, including users, posts, comments, reactions, communities, memberships, games, and related feed data. This simplifies development and allows related application operations to share a consistent data layer.

### User Index Migration

User indexes are managed deliberately through:

```text
scripts/migrateUserIndexes.js
```

The migration is separate from application startup. User schema auto-indexing is disabled so that the server does not implicitly apply the migration.

First, inspect the existing indexes and duplicate counts:

```powershell
node scripts/migrateUserIndexes.js --dry-run
```

Review the proposed changes before applying anything.

To apply the migration, explicitly confirm the operation:

```powershell
$env:CONFIRM_USER_INDEX_MIGRATION='yes'
node scripts/migrateUserIndexes.js --apply
```

The migration creates string-only partial unique indexes before removing replaced legacy single-field unique indexes. It stops if duplicate string values or an unexpected compound index are detected.

It does not edit documents or drop collections.

The earlier inspection of the selected `mkstudios` database found a full unique `username_1` index, no email index, and zero user documents or duplicate groups. That inspection did not apply the migration. Recheck the actual target database before making changes.

### Atlas Configuration

For local development:

1. Create a database user with the necessary permissions.
2. Configure Atlas Network Access to allow the development machine's current IP address.
3. Store the connection URI in the ignored local `.env` file.

For production:

1. Configure `MONGODB_URI` in Render.
2. Configure Atlas Network Access to permit connections from the deployed application.
3. Prefer an appropriate restricted network-access configuration over unrestricted access where practical.

If a database password contains reserved URI characters, percent-encode the password portion of the connection string.

Never expose the complete connection URI in logs, screenshots, public repositories, or client-side code.

---

## Application Architecture and Data Models

### User

The `User` model stores account identity and profile information, including:

- Normalized username.
- Password hash.
- Public profile fields.
- Gaming genres and favorite games.
- Onboarding preferences.
- Privacy settings.
- Account creation metadata.

Usernames follow the application's lowercase username format and validation rules.

Password hashes are excluded from normal query results unless explicitly requested by trusted server-side authentication logic.

### Session

The `Session` model supports persistent server-managed sessions.

It stores:

- A hashed opaque session token.
- A private session CSRF token.
- A user reference.
- Expiration metadata.
- A TTL index for expired-session cleanup.

Browser session cookies use `httpOnly`, `SameSite=Strict`, and secure-cookie settings in production or when running under Render.

### Game

The `Game` model contains the curated game catalog.

Its fields include:

- Unique game slug.
- Game name and aliases.
- Genres and supported platforms.
- Description and visual accent.
- Optional artwork.
- Active status.

Games provide the foundation for game discovery, game-specific content, and associated communities.

### Community

The `Community` model represents gaming communities and their configuration.

It supports:

- Unique community slug.
- Associated game.
- Rules and description.
- Visibility settings.
- Visual accent.
- Member count.

Community visibility and access must be respected by community discovery, membership, and content queries.

### Membership

The `Membership` model connects users to communities.

It supports owner, moderator, and member roles.

A unique compound index on community and user prevents duplicate membership records.

### Post

The `Post` model stores social content.

Its structure includes:

- Author reference.
- Post body.
- Destination array.
- Media metadata.
- Interaction counters.
- Creation and update timestamps.

Destinations distinguish general-feed posts, game-related posts, and community-specific posts.

The media structure supports the application's cloud-media workflow. Uploaded files should be stored in Cloudinary, with the necessary URLs and metadata persisted in MongoDB rather than relying on ephemeral local application storage.

### Comments, Reactions, and Reposts

These models provide persistent social interactions.

- `Comment` stores discussion entries associated with posts.
- `Reaction` stores user reactions to posts.
- `Repost` records users sharing existing posts.

Unique indexes prevent duplicate user/post reaction and repost records. Comment retrieval is bounded, and relevant queries use indexes to support efficient pagination.

### Feed Personalization

Arcadia's feed infrastructure includes dedicated components for serving, ranking, and personalizing content.

The implementation includes:

- `FeedHide`
- `FeedServed`
- `UserInterest`
- `feedEngine`
- `feedRanking`

These components support feed delivery, ranking, interest signals, and the evolving personalization system.

Feed retrieval uses bounded pages and opaque ObjectId cursors. Ranking and personalization should remain compatible with these pagination guarantees.

The general feed explicitly selects posts with the `general` destination. Community-only posts must not leak into general-feed queries.

Community post creation checks membership and must also respect the community's access rules.

### Index Strategy

The intended index coverage includes:

| Model | Index purpose |
|---|---|
| `User` | Partial unique username and email indexes; creation-time lookup. |
| `Session` | Unique token hash, user lookup, and expiration TTL. |
| `Game` | Unique slug, active/name lookups, and genre/active lookups. |
| `Community` | Unique slug and game/active/name lookups. |
| `Membership` | Unique community/user pair and user/creation-time lookup. |
| `Post` | Destination and author/creation-time queries. |
| `Comment` | Post/creation-time/ObjectId pagination. |
| `Reaction` | Unique user/post pair and post/creation-time lookup. |
| `Repost` | Unique user/post pair. |

User indexes are managed separately by the explicit migration script. Existing user indexes are not automatically recreated during ordinary application startup.

---

## API and Security

### Health Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Reports process health. |
| `GET /api/health/db` | Reports MongoDB connectivity and returns HTTP 503 while disconnected. |

Unknown `/api/*` routes return the application's JSON 404 response.

### API Design Principles

- Keep API responses bounded and predictable.
- Use cursor-based pagination for growing content collections.
- Enforce authentication for protected actions.
- Enforce authorization for private content and community operations.
- Avoid exposing password hashes, session secrets, or private account fields.
- Render user-provided text safely using `textContent` where appropriate.
- Validate and constrain uploaded media.
- Store media in object storage instead of writing persistent application data to the Render filesystem.
- Keep database access and authorization logic on the server.

Security-sensitive changes should preserve the existing session, CSRF, rate-limiting, CORS, and Helmet protections.

---

## Media Storage

Arcadia supports cloud-based media storage through Cloudinary.

This approach is appropriate for profile images and supported post attachments because application instances should not be treated as permanent file-storage locations.

The intended media workflow is:

1. A user selects supported media.
2. The application validates the upload.
3. The server processes the upload through the configured media provider.
4. Cloudinary stores the media.
5. MongoDB stores the associated URL and metadata.
6. The frontend displays the media through the resulting URL.

Cloudinary credentials must be configured in the local environment and Render.

When modifying upload behavior, preserve existing upload limits, validation, authorization, error handling, and frontend expectations.

S3-compatible object storage remains a possible alternative if Arcadia's storage requirements change.

---

## Deployment on Render

Arcadia is deployed as a single Render Web Service.

The current deployment configuration is:

```text
Build Command: npm install && npm run frontend:build
Start Command: npm start
Health Check Path: /api/health
```

The deployment uses the `master` branch of the connected GitHub repository unless the service configuration is deliberately changed.

### Production Environment

Configure the following through Render's environment settings as required:

- `MONGODB_URI`
- Cloudinary credentials and configuration.
- Any additional production-specific variables required by the current implementation.

Render supplies the runtime `PORT` and configures the production environment.

`CLIENT_URL` is optional for a same-origin deployment. If a separate frontend is introduced, configure the exact permitted origins.

### Frontend and API Hosting

The Express server serves the built Vite frontend from `dist` and handles API requests from the same service.

This same-origin architecture simplifies deployment and reduces the need for separate frontend hosting or cross-origin API configuration.

After changing frontend code, run the production build and deploy the intended commit to the configured Render branch.

### Repository and Service Naming

Arcadia is the product name. MKSTUDIOS remains the development and publishing identity.

For consistency, the intended naming can be:

| Resource | Recommended identity |
|---|---|
| Product | Arcadia |
| GitHub repository | `Arcadia` or `arcadia` |
| Render service | `arcadia`, if available |
| Public website | A custom Arcadia domain, once purchased and configured |

Renaming the GitHub repository does not automatically rename the Render service or change its public URL.

After renaming a repository, update the local Git remote and verify that Render still has access to the repository and is configured to deploy the intended branch.

### Custom Domain

A custom domain can be connected without moving the application to another hosting provider.

The process is:

1. Register the desired domain with a domain registrar.
2. Add the domain under the Render service's Custom Domains settings.
3. Configure the DNS records specified by Render.
4. Verify the domain.
5. Confirm that HTTPS works and the application remains accessible.

Render manages SSL certificates for supported custom domains.

Do not change DNS records based on generic examples when Render provides service-specific values.

---

## Local Verification and Testing

The project uses Node's built-in test runner.

Tests cover areas including:

- Process health and static hosting.
- Username and index contracts.
- Profile serialization.
- Guest-access restrictions.
- Post destination visibility.
- Social API behavior and integration contracts.

Social integration tests use an in-memory MongoDB instance with a database named `mkstudios_test`.

They skip when no suitable local MongoDB binary is available unless `MONGOMS_ALLOW_DOWNLOAD=1` is explicitly enabled.

Tests do not read the project's `.env` file.

The test environment requires appropriate safeguards so that integration tests cannot accidentally connect to or modify a production database.

Before deploying significant changes, run:

```powershell
npm.cmd test
npm.cmd run frontend:build
```

Investigate failures before deploying rather than treating a successful build alone as proof that the application is correct.

The catalog seed should be run separately when the intended database needs initial game and community records.

---

## Product Direction and Development Roadmap

Arcadia is being developed as a unified social gaming platform rather than merely a game catalog or discussion board.

The core experience is built around discovering games, sharing content, connecting with other gamers, and participating in communities.

### Existing Foundation

The application includes the principal account, profile, feed, community, and game infrastructure, together with feed pagination and personalization work.

Supported media uploads use cloud storage.

The existing architecture is intended to remain the foundation for future social features.

### Planned Social Improvements

The broader product direction includes:

- Friends-only and personalized feed experiences.
- Friend requests and friend discovery.
- Profile and banner customization.
- Profile privacy controls.
- Improved post composition and social interactions.
- Community discovery and participation.
- Notifications and activity indicators.
- Direct messaging with persistent history.
- Read receipts and unread-message indicators.
- Real-time delivery through Socket.IO.
- Future support for message attachments and voice notes.

These items describe the product roadmap and should not all be interpreted as currently implemented.

Before extending an individual feature, inspect the latest code and tests to determine its actual implementation status.

### Messaging Architecture

Direct messaging is intended to use persistent MongoDB records and Socket.IO for real-time delivery.

MongoDB should remain the durable source of truth for messages. Socket connections should provide real-time delivery rather than serving as the only record of a conversation.

If the application later runs multiple instances, evaluate a shared Socket.IO adapter, such as Redis, to coordinate event delivery.

Presence, multi-device tracking, advanced chat settings, message attachments, and voice notes can be introduced incrementally after the fundamental messaging workflow is stable.

### Database and Service Strategy

Keep the application in one primary MongoDB database while the project remains at its current scale.

Users, posts, communities, memberships, messages, games, and supporting metadata can share this database.

Use cloud object storage for media files and store references and metadata in MongoDB.

Consider separating services only when actual traffic, reliability, security, or operational requirements justify the added complexity.

---

## Project Principles

Arcadia's ongoing development should prioritize:

1. **Reliability:** Preserve existing working functionality while adding features.
2. **Security:** Protect accounts, sessions, private content, and uploaded media.
3. **Performance:** Use bounded queries, suitable indexes, pagination, and efficient feed ranking.
4. **Consistency:** Follow the existing design system across desktop and mobile.
5. **Maintainability:** Keep the architecture understandable and avoid unnecessary infrastructure.
6. **Data integrity:** Use deliberate migrations and safe database operations.
7. **User experience:** Make gaming discovery, social interaction, and community participation straightforward.
8. **Incremental development:** Verify changes with tests and production builds before deployment.

Arcadia's goal is to become a dependable home for gamers to discover games, share experiences, build friendships, and grow communities, with MKSTUDIOS continuing as its development identity.
