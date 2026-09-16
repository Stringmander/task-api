# BUILD_PLAN

## Goal

Complete, tested, containerized task-management REST API serving as
GitHub proof of backend competence. Ship quality over speed; total
budget 22-25 hours across five phases.

## Decisions Record

| Area | Decision | Rationale |
|---|---|---|
| Runtime | Node 24 LTS via fnm, .nvmrc pinned | Current LTS, supported to 2028 |
| Language | TypeScript (strict) | Existing fluency; backend proof must be TS |
| Framework | Fastify | Native TS, JSON Schema validation, inject() testing |
| Database | PostgreSQL 17 in Docker | Matches production model, zero host install |
| ORM | Drizzle + drizzle-kit | SQL-shaped API teaches SQL; migrations as committed SQL |
| Auth libs | jose + bcryptjs (cost 12) | jose is the modern JWT standard; bcryptjs avoids native build issues |
| Token lifecycle | Access 15 min / refresh 7 days, rotation on refresh, hashed storage | Revocable sessions, strong portfolio signal |
| Test runner | Vitest | 2026 default for new TS projects, native ESM |
| Test approach | Real Postgres in Docker, ~28 tests | Integration credibility over mocked units |
| Containers | Multi-stage Dockerfile, 2-service compose, healthcheck gating | Boring and correct |
| CI | GitHub Actions: test job (postgres service + vitest) + lint job | Badge credibility |
| API docs | OpenAPI spec generated from route schemas via @fastify/swagger (Phase 5); Bruno/OpenCollection request collection committed under http/ for manual testing | Spec is derived from code, not hand-maintained; collection preserves the executable verification workflow |
| Input validation | Strict; Ajv coerceTypes disabled | Unexpected input types get loud 400s; leniency must be declared, never implicit |

## Domain Model

users (1) -> (*) projects (1) -> (*) tasks

- users: id, email UNIQUE NOT NULL, password_hash, display_name, created_at, updated_at
- projects: id, user_id FK NOT NULL CASCADE, name NOT NULL, description NULL, timestamps
- tasks: id, project_id FK NOT NULL CASCADE, title NOT NULL, description NULL,
  status DEFAULT 'todo' CHECK IN (todo, in_progress, done),
  priority DEFAULT 'medium' CHECK IN (low, medium, high),
  due_date NULL, position INTEGER DEFAULT 0, timestamps

## Endpoints

- POST   /auth/register       -> 201, hashes password
- POST   /auth/login          -> 200, returns {accessToken, refreshToken}
- POST   /auth/refresh        -> 200, rotates refresh token
- GET    /projects            -> 200, list owned only
- POST   /projects            -> 201, validate name 1-100 chars
- GET    /projects/:id        -> 200 | 403 if not owner
- PATCH  /projects/:id        -> 200, partial update
- DELETE /projects/:id        -> 204, cascades tasks
- GET    /projects/:id/tasks  -> 200, ownership via project
- POST   /projects/:id/tasks  -> 201, defaults status=todo priority=medium
- GET    /tasks/:id           -> 200 | 403 via project ownership
- PATCH  /tasks/:id           -> 200, partial; validate status/priority enums
- DELETE /tasks/:id           -> 204

Errors: consistent shape { statusCode, error, message }.
No user enumeration: login failure returns identical 401 for
unknown email and wrong password.

## Test Plan (~28 tests, Vitest + inject(), real Postgres)

- Auth (8-10): register happy/invalid/duplicate, hash stored not
  plaintext, login success/wrong-password/unknown-email,
  refresh success/reuse-rejected
- Authorization (4-5): 401 no token, 401 expired, 403 cross-user
  project GET/PATCH, list isolation
- Projects (5-6): create/list-scoped/get/cascade-delete/
  empty-name 400/name-boundary 400
- Tasks (6-7): defaults, explicit fields, PATCH partial semantics,
  invalid status 400, invalid priority 400, cross-owner 404, delete
- Integration (1-2): register -> login -> project -> task ->
  update -> delete lifecycle

Isolation: truncate tables before each test file; fixtures per suite.

## Phases

### Phase 1 - Scaffold + schema + migrations (~3-4h)
Status: COMPLETE, verified 2026-09-01

### Phase 2 - CRUD routes + validation (~5-6h)
Status: COMPLETE and verified 2026-09-04. Routes written via
guided practice against docs/ROUTE_PATTERN.md.

### Phase 3 - Auth (~4-5h)
Register + bcryptjs(12), login issuing jose token pair (access
payload: sub/iat/exp; refresh payload: sub/jti/iat/exp - jti added
after the reuse bug below), refresh rotation with SHA-256 hashed
storage in refresh_tokens table, fail-closed preHandler hook.

Bug found and fixed (2026-09-15/16, `dbd59e8`): signRefreshToken
originally signed only sub/iat/exp. iat/exp are second-granularity
and HS256 signing is deterministic, so two refresh tokens issued for
the same user within the same wall-clock second - trivial to hit
locally - came out byte-identical, silently defeating
reuse-rejection: the row rotation inserted had the same token_hash
as the row it had just deleted. Found via
http/tests/auth/refresh-original-token.yml returning 200 instead of
401 in a live collection run, confirmed with raw curl outside Bruno
before touching any code. Fixed by adding a random jti
(crypto.randomUUID()) to the refresh token only - access tokens
aren't DB-tracked or compared for equality anywhere, so they have no
uniqueness invariant to violate.

Sub-task (added 2026-09-06, done 2026-09-15): upgraded http/
collection to scripted variable capture — login/refresh capture
accessToken/refreshToken as secret variables (declared in
http/environments/local.yml; the declaration is safe to commit,
the value never is - Bruno stores it locally); create-project/
create-task capture {{projectId}}/{{taskId}}. Replaces the manual
id threading previously documented in the README. Also added an
auth/ folder (register/login/refresh) and moved delete-project into
a new cleanup/ folder that runs after tasks/ - deleting the
walkthrough's project before the tasks/ folder runs would otherwise
break every task request that depends on it still existing.
Verified via `bru run -r --env local` end to end: all 26 requests
return exactly the status code each is designed to test.

### Phase 4 - Test suite (~6-7h)
Suites in order: auth, authorization, projects, tasks, integration.
Target: green suite of ~28 tests against real Postgres.

### Phase 5 - Docker + CI + docs (~3-4h)
Multi-stage Dockerfile (non-root runtime), docker-compose with
healthcheck, GitHub Actions (test + lint jobs), README with badges,
setup steps, endpoint reference, OpenAPI spec via @fastify/swagger,
Bruno/OpenCollection request collection committed under http/.

## Session Rules

- At least one commit per working session (streak milestone).
- Repo green and bootable at end of every session.
- Phases are resumable: end-of-phase state is the checkpoint.
- Buffer honored: 22-25h scheduled. No rushing to ship.

## Definition of Done

- [ ] 14 endpoints implemented with validation
- [ ] ~28 tests passing locally and in CI
- [ ] Green CI badges on README
- [ ] Multi-stage image builds and compose boots from clean clone
- [ ] README sufficient for a stranger to run the project
- [ ] Commit history reads as deliberate, conventional commits
