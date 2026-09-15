# task-api

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
| API docs   | OpenAPI spec generated from route schemas (Phase 5)         |

<!-- TODO(Claude): add CI badge + lint badge once GitHub Actions
     workflow exists (Phase 5) -->

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

<!-- TODO(Phase 3): document /auth/register, /auth/login, /auth/refresh, token lifecycle (15-minute access tokens, 7-day rotating refresh tokens stored hashed), and the Bearer-token preHandler. Also update the ownership notes above: "current user" becomes real, not the stub. -->

**Status: authentication is not yet implemented.** Ownership scoping exists at the route layer and will be enforced by real auth in an upcoming phase.

## Database

Three tables: `users`, `projects`, `tasks` (plus Drizzle's migration bookkeeping). Schema changes are managed exclusively through committed SQL migrations:

```bash
npm run db:generate  # emit a migration from src/db/schema.ts changes
npm run db:migrate   # apply pending migrations
```

The `drizzle-kit push` shortcut is intentionally not used; the migration history in `drizzle/` is the reproducible path from a clean clone to the current schema.

## Testing

<!-- TODO(Phase 4): document `npm test`, the Vitest setup, running tests against the Docker database, and the suite's coverage areas (auth, authorization, CRUD, lifecycle). -->

Tests arrive with the test phase; the plan is integration tests against a real PostgreSQL instance via Fastify's `inject()`.

## API Specification

<!-- TODO(Phase 5): generate openapi.yaml from route schemas via @fastify/swagger per the decisions record; document how to regenerate and (optionally) serve Swagger UI in dev mode. Never hand-edit the generated spec. -->

The API will ship an OpenAPI specification generated directly from the route validation schemas (Phase 5). Hand-editing the generated file is prohibited; it is derived from code, not maintained alongside it.

## Docker

<!-- TODO(Phase 5): document the multi-stage production build and `docker compose up --build` for the full stack. -->

Local development uses Docker Compose for PostgreSQL only; the API runs on the host under `npm run dev`.

## Project Structure

```
src/
├── app.ts        # builds the Fastify instance, registers plugins and routes
├── server.ts     # process entrypoint — starts listening
├── env.ts        # loads and validates environment variables
├── routes/       # route definitions (auth, projects, tasks)
├── lib/          # shared logic (ownership checks, id param schema, error shaping, tokens)
├── db/           # Drizzle schema, client, and migration runner
└── plugins/      # Bearer-token preHandler — verifies access tokens, sets request.user
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
