# task-api

[![CI](https://github.com/Stringmander/task-api/actions/workflows/ci.yml/badge.svg)](https://github.com/Stringmander/task-api/actions/workflows/ci.yml)

A task management REST API built with TypeScript, Fastify, and
PostgreSQL. Users own projects; projects contain tasks; access is
scoped to the authenticated user at every layer.

Built as a portfolio project: complete, tested, containerized, and
documented end-to-end.

## Tech Stack

| Layer      | Choice                                                      |
| ---------- | ----------------------------------------------------------- |
| Runtime    | Node.js 24 LTS (pinned via `.nvmrc`)                        |
| Language   | TypeScript (strict mode)                                    |
| Framework  | Fastify with JSON Schema request validation                 |
| Database   | PostgreSQL 17                                               |
| ORM        | Drizzle with drizzle-kit migrations (SQL files committed)   |
| Testing    | Vitest via Fastify `inject()` against a real database       |
| Containers | Multi-stage Docker build, docker-compose for local Postgres |
| API docs   | OpenAPI spec generated from route schemas via `@fastify/swagger` |

## Prerequisites

- [Node.js](https://nodejs.org) 24 LTS (or [fnm](https://github.com/Schniz/fnm) — `.nvmrc` handles the version)
- Docker and Docker Compose
- Git

## Getting Started

```bash
# Clone
git clone https://github.com/Stringmander/task-api.git task-api
cd task-api

# Install dependencies (Node version switches automatically with fnm)
npm install

# Start PostgreSQL in Docker
docker compose up -d db

# Apply database migrations
npm run db:migrate

# Start the dev server
npm run dev
```

The API listens on `http://localhost:3000` (confirm `PORT` in `.env`). Verify with:

`curl http://localhost:3000/health`

## API Request Collection

An [OpenCollection](https://www.opencollection.com) request collection covering every endpoint lives in [`http/`](/http/) — executable API requests in an open, tool-agnostic YAML format, importable by [Bruno](https://www.usebruno.com) (and Postman, Insomnia, or any OpenCollection-compatible client).

The collection is organized as a walkthrough with no manual copy-pasting: `login`'s response script captures `accessToken`/`refreshToken`, `create-project`/`create-task`'s capture `projectId`/`taskId` — every later request in the chain references those as `{{variables}}` instead of a hardcoded id. Run `auth/` → `projects/` → `tasks/` → `cleanup/` in order (or the whole collection recursively) and it re-runs cleanly end to end. Error-path requests use deliberately-invalid values by design.

Requests are grouped into `auth/`, `projects/`, `tasks/`, and `cleanup/` folders matching the route groups above (`cleanup/` holds `delete-project` specifically, run last since deleting the walkthrough's project would otherwise break every `tasks/` request that depends on it still existing), with filenames following a `verb-noun[-modifier].yml` convention (e.g. `create-project.yml`, `create-project-name-too-long.yml`). An `http/environments/local.yml` environment (named `Local`) provides `{{baseUrl}}`; select it in your client before running any request.

`accessToken` and `refreshToken` are declared as secret variables in that same environment file — the declaration is safe to commit (it's just a name and a type), but the actual value is never written to any file; Bruno stores it locally, encrypted, and `login`/`refresh`'s scripts populate it fresh on each run.

## API Endpoints

### Health

| Method | Path      | Description    |
| ------ | --------- | -------------- |
| GET    | `/health` | Liveness check |

### Projects

| Method | Path            | Description                                   |
| ------ | --------------- | --------------------------------------------- |
| GET    | `/projects`     | List the current user's projects              |
| POST   | `/projects`     | Create a project (name required, 1-100 chars) |
| GET    | `/projects/:id` | Get one project (owner only)                  |
| PATCH  | `/projects/:id` | Partially update a project                    |
| DELETE | `/projects/:id` | Delete a project (cascades to its tasks)      |

### Tasks

| Method | Path                  | Description                |
| ------ | --------------------- | -------------------------- |
| GET    | `/projects/:id/tasks` | List tasks in a project    |
| POST   | `/projects/:id/tasks` | Create a task in a project |
| GET    | `/tasks/:id`          | Get one task               |
| PATCH  | `/tasks/:id`          | Partially update a task    |
| DELETE | `/tasks/:id`          | Delete a task              |

Task fields: `title` (required), `description`, `status` (`todo` | `in_progress` | `done`, default `todo`), `priority` (`low` | `medium` | `high`, default `medium`), `due_date`, `position` (default `0`).

Requests and responses are JSON. Unexpected input types are rejected with `400` — no silent coercion. Errors use a consistent shape: `{ "statusCode": ..., "error": ..., "message": ... }`.

Deleting a project cascades to its tasks at the database level (foreign key `ON DELETE CASCADE`).

### Authentication

| Method | Path             | Description                                     |
| ------ | ---------------- | ------------------------------------------------ |
| POST   | `/auth/register` | Create a user (email, password, displayName)    |
| POST   | `/auth/login`    | Exchange credentials for an access/refresh pair  |
| POST   | `/auth/refresh`  | Rotate a refresh token for a new pair            |

All `/projects` and `/tasks` routes above require `Authorization: Bearer <accessToken>`; `"current user"` in their descriptions means whoever that token belongs to, verified on every request, not passed by the client.

- **Access tokens:** 15-minute expiry, stateless (payload is just `sub`/`iat`/`exp` — nothing revocable server-side).
- **Refresh tokens:** 7-day expiry, tracked server-side (hashed, never stored raw) and rotated on every use — presenting one invalidates it and issues a new pair. A token that's already been rotated away (or never existed) is rejected identically to a garbage one; there's no way, or need, to tell "reused" apart from "never issued."
- **Password hashing:** bcrypt, cost factor 12.
- Login and register return the same `401` for an unknown email as for a wrong password — no user enumeration via response differences.
- A single Fastify `preHandler` hook verifies the Bearer token on every route by default and fails closed: a route has to opt out explicitly (`config: { public: true }`, used by `/health`, `/openapi.json`, and `/auth/*` itself) rather than opt in, so a route that forgets to declare itself protected stays protected anyway.

## Database

Three tables: `users`, `projects`, `tasks` (plus Drizzle's migration bookkeeping). Schema changes are managed exclusively through committed SQL migrations:

```bash
npm run db:generate  # emit a migration from src/db/schema.ts changes
npm run db:migrate   # apply pending migrations
```

The `drizzle-kit push` shortcut is intentionally not used; the migration history in `drizzle/` is the reproducible path from a clean clone to the current schema.

## Testing

```bash
docker compose up -d db   # tests need Postgres running
npm test
```

55 integration tests (Vitest + Fastify's `inject()`, no mocking) against a real, disposable `taskapi_test` database — dropped and recreated fresh before the run, so there's no drift between what's tested and the current migrations:

| Suite                    | Tests | Covers                                                                                         |
| ------------------------ | ----- | ------------------------------------------------------------------------------------------------ |
| `auth.test.ts`           | 10    | Register/login/refresh - validation, duplicate email, rotation, reuse rejection                |
| `authorization.test.ts`  | 11    | The Bearer preHandler itself (missing/garbage/expired token) and cross-user 403s on every mutating route |
| `projects.test.ts`       | 15    | CRUD, validation boundaries, cascade-delete to a project's tasks                                |
| `tasks.test.ts`          | 18    | CRUD, partial-update semantics, validation boundaries                                           |
| `integration.test.ts`    | 1     | A full register → login → create → update → delete lifecycle                                    |

`vitest.config.ts` runs test files sequentially (`fileParallelism: false`), since they share one database.

## API Specification

An OpenAPI 3.0 specification is generated directly from the route validation schemas via [`@fastify/swagger`](https://github.com/fastify/fastify-swagger) — never hand-edited, since it's derived from code, not maintained alongside it.

- **Committed copy:** [`openapi.yaml`](/openapi.yaml), regenerated with `npm run docs:openapi` whenever a route schema changes.
- **Live copy:** `GET /openapi.json` on a running server — always current, no regeneration step.

No interactive Swagger UI: `@fastify/swagger-ui` registers its own routes with no way to exempt them from this API's global Bearer-auth preHandler (see `src/plugins/bearer-auth.ts`), and that file's fail-closed design isn't worth bending for a documentation page. The raw spec imports directly into [Swagger Editor](https://editor.swagger.io), Postman, or any OpenAPI-compatible client instead.

## Docker

```bash
docker compose up -d --build   # Postgres + the API, both containerized
```

The `Dockerfile` is a multi-stage build: a `build` stage installs full dependencies and compiles with `tsc`, then a `runtime` stage installs production dependencies only and copies over just the compiled `dist/` and the SQL migrations in `drizzle/` — no TypeScript source or dev tooling ships in the final image. It runs as the non-root `node` user that `node:alpine` images provide out of the box, and declares a `HEALTHCHECK` against `/health`.

`docker-compose.yml`'s `app` service depends on `db`'s own healthcheck (`condition: service_healthy`), so it won't start against a database that isn't actually ready yet, not just one that's merely running. Migrations aren't applied automatically on container start — that's a deliberate, separate step, since auto-migrating on boot gets risky with multiple replicas or a rollback:

```bash
docker compose exec app node dist/db/migrate.js
```

For active development (hot reload, no rebuild per change), use the [Getting Started](#getting-started) flow instead — `docker compose up -d db` for Postgres only, `npm run dev` for the API on the host.

## Project Structure

```
src/
├── app.ts        # builds the Fastify instance, registers plugins and routes
├── server.ts     # process entrypoint — starts listening
├── env.ts        # loads and validates environment variables
├── routes/       # route definitions (auth, projects, tasks)
├── lib/          # shared logic (ownership checks, id param schema, error shaping, tokens)
├── db/           # Drizzle schema, client, and migration runner
├── plugins/      # Bearer-token preHandler — verifies access tokens, sets request.user
└── scripts/      # one-off operational scripts (e.g. OpenAPI spec generation)
drizzle/          # committed SQL migrations + drizzle-kit snapshot metadata
http/             # OpenCollection request collection (Bruno et al.)
docs/             # build plan, route pattern guide
.claude/          # AI-assistant workflow commands
```

## Conventions

- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, ...)
- Every commit leaves the repo bootable
- Schema changes only via migrations, never direct DDL pushes

## License

[MIT](./LICENSE)
