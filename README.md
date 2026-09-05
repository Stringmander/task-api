# task-api

A task management REST API built with TypeScript, Fastify, and
PostgreSQL. Users own projects; projects contain tasks; access is
scoped to the authenticated user at every layer.

Built as a portfolio project: complete, tested, containerized, and
documented end-to-end.

<!-- TODO(Claude): update name/title if repo name differs -->

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

<!-- TODO(Claude): verify script names against package.json and
     update any that differ -->

```
# Clone
git clone <repo-url> task-api
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

The collection is organized as a walkthrough: setup requests capture created ids into variables (`{{projectId}}`, `{{taskId}}`), so the whole chain re-runs cleanly after a database reset. Error-path requests use deliberately-invalid values by design.

Sensitive values (auth tokens from Phase 3 onward) belong in secret environment variables, never in committed files.

<!-- TODO(Claude): verify request filenames against the actual collection contents and correct this section if needed -->

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

`npm run db:generate # emit a migration from src/db/schema.ts changes npm run db:migrate # apply pending migrations`

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

<!-- TODO(Claude): flesh out from the actual tree; verify each path exists before listing it -->

`src/ ├── routes/ # route definitions (projects, tasks) ├── lib/ # shared logic (ownership checks) ├── db/ # Drizzle schema and client setup └── ... # server bootstrap drizzle/ # committed SQL migrations http/ # OpenCollection request collection (Bruno et al.) docs/ # build plan, route pattern guide .claude/ # AI-assistant workflow commands`

## Conventions

- Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, ...)
- Every commit leaves the repo bootable
- Schema changes only via migrations, never direct DDL pushes

## License

[MIT](./LICENSE)
