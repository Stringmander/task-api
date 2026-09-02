# Route Pattern

The repeatable shape for every CRUD route in this project, extracted from
`POST /projects` (`src/routes/projects.ts` + `src/plugins/stub-auth.ts`).
Follow this for every remaining Phase 2 endpoint.

## The steps, in order

1. **Migration first.** If the route needs a schema change, write and run
   the Drizzle migration before touching route code (CLAUDE.md rule: "write
   the migration before the route that needs it"). All three tables already
   exist, so most Phase 2 routes skip this step.

2. **JSON Schema for the request.** Define a `const ... = { ... } as const`
   object per route (body for POST/PATCH, params for anything with `:id`,
   querystring if you add filtering later). Always set
   `additionalProperties: false` on object schemas — it's the mechanism
   that stops a client smuggling extra fields like `userId` or `id` into a
   request body. Know what it actually does: Fastify's AJV defaults
   (`removeAdditional: true`) mean unknown properties are silently
   **stripped**, not rejected with 400 — verify this with a manual request
   if it matters for a specific route, don't assume from the schema alone.

3. **A hand-written TS interface next to the schema.** Nothing keeps the
   JSON Schema and the TS type in sync automatically in this project (no
   TypeBox/JSON-Schema-to-TS provider is installed). Write the interface
   right next to the schema so a change to one is hard to make without
   noticing the other.

4. **Route registration with the schema wired in and the body/params
   generic-typed:**

   ```ts
   app.post<{ Body: CreateProjectBody }>(
     '/projects',
     { schema: { body: createProjectBodySchema } },
     async (request, reply) => { ... },
   );
   ```

   This gets you validated input *and* a typed `request.body`/`request.params`
   with no manual casting.

5. **Ownership scoping — the shape depends on the HTTP verb:**
   - **POST (create):** force the owning id from `request.user.id`. Never
     read an owner/user id out of the request body, even if the schema
     would allow it.
   - **GET/PATCH/DELETE on an existing resource:** the ownership check is a
     `WHERE` clause (or an explicit post-query check) filtering by
     `request.user.id`, returning **403** for someone else's resource, not
     404 — 404 would leak whether the id exists at all. Tasks are owned
     transitively: check ownership via the parent project's `user_id`, not
     a copy of it on the task row.
   - Either way, `request.user.id` is the only source of identity. It's
     populated today by `src/plugins/stub-auth.ts` (a header-based stub,
     replaced wholesale in Phase 3) — route code should never care which.

6. **Let Fastify's schema validation produce the error response.** A failed
   body/params validation already returns
   `{ statusCode: 400, error: "Bad Request", message: "..." }` (plus an
   AJV `code` field), matching the shape docs/BUILD_PLAN.md requires. Don't
   hand-write 400 responses for validation failures — write the schema
   correctly and let Fastify's default error handler do it. Write manual
   error responses only for business-logic failures the schema can't
   express (ownership 403, not-found 404, conflict 409, etc.).

7. **Register the route module in `src/app.ts`** via
   `void app.register(routeFile)`, after `registerStubAuth(app)` so
   `request.user` exists by the time the handler runs.

8. **Verify by hand before moving on:** start `docker compose up -d db`,
   run `npm run db:migrate` if the migration changed, `npm run dev`, and
   curl the happy path plus the failure paths (validation error, ownership
   violation, cross-user access) with different `x-stub-user-id` values.
   `npm run build` and `npm run lint` must both stay clean. Clean up any
   rows you inserted for manual testing before committing — Phase 4 owns
   the automated test suite; this phase's verification is manual.

## What NOT to do

- Don't add a custom error-formatting layer "for consistency" — Fastify's
  default already matches the required shape for validation errors; a
  wrapper is more surface area to keep in sync for no benefit yet.
- Don't add anything auth-shaped beyond reading `request.user.id`. Phase 3
  owns login/register/tokens; Phase 2 routes should be trivially portable
  to real auth by construction, not need edits when it lands.
- Don't accept an id (user id, project id as an owner reference, etc.) from
  the request body for anything the server can already derive from
  `request.user` or the URL.
