# Task API - Build Instructions for Claude

## Project Purpose

Portfolio-grade REST API demonstrating production backend practices:
Node.js + Fastify + PostgreSQL + Drizzle ORM + JWT auth + Docker + CI.
Audience for all deliverables: prospective clients evaluating this repo
as proof of shipping ability. Boring, clean, and complete beats novel.

## Stack (locked, do not substitute)

- Node 24.20.x (pinned in .nvmrc, enforced via engines field)
- TypeScript, strict mode
- Fastify (routes, JSON Schema validation, app.inject() for tests)
- PostgreSQL 17, accessed via Drizzle ORM
- Migrations: drizzle-kit generate + migrate (SQL files committed to repo)
- Auth: jose (JWT), bcryptjs (password hashing, cost factor 12)
- Tests: Vitest via Fastify inject(), real Postgres (docker-compose)
- Lint/format: eslint + prettier
- Container: multi-stage Dockerfile, non-root user

## Domain

Task management API. Ownership chain: users -> projects -> tasks.
Every project and task operation is scoped to the authenticated user.
Deletion cascades: user -> projects -> tasks.

## Schema (3 tables)

- users: id, email (unique), password_hash, display_name, timestamps
- projects: id, user_id FK CASCADE, name, description, timestamps
- tasks: id, project_id FK, title, description, status
  (todo|in_progress|done), priority (low|medium|high), due_date,
  position, timestamps

IDs are bigint serial. Timestamps are timestamptz.
CHECK constraints enforce status/priority values.

## Endpoints (14)

Auth: POST /auth/register, /auth/login, /auth/refresh
Projects (auth required, owner-scoped):
  GET/POST /projects, GET/PATCH/DELETE /projects/:id
Tasks (auth required, ownership via project join):
  GET/POST /projects/:id/tasks, GET/PATCH/DELETE /tasks/:id

Updates use PATCH (partial update semantics).

## Auth Contract

- Access token: 15 min expiry, payload = sub/iat/exp only.
- Refresh token: 7 days, stored hashed in refresh_tokens table,
  rotated on every use (old token invalidated at exchange).
- 401 = unauthenticated, 403 = authenticated but not authorized.
- Single Fastify preHandler hook verifies Bearer token via jose,
  attaches request.user, fails closed.

## Commands

- npm run dev        - dev server with watch
- npm run build      - tsc compile
- npm run test       - vitest run
- npm run lint       - eslint + tsc --noEmit
- docker compose up -d db          - start local Postgres
- docker compose up -d --build     - full stack

## Rules

- Never log or return password hashes or tokens in responses.
- Never trust client-supplied ids for ownership; filter by user id.
- Every session ends with the repo in a green, bootable state.
- Follow conventional commits (feat/fix/test/docs/chore/build/ci).
- Small commits: one logical change each.
- Write the migration before the route that needs it.

## Build Phases

Details and acceptance criteria: docs/BUILD_PLAN.md
Order: scaffold -> schema/migrations -> CRUD -> auth -> tests ->
docker/CI/docs. Each phase ends green. Each session yields >= 1 commit.
