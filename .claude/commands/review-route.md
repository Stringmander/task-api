---
description: Review one or more route files against docs/ROUTE_PATTERN.md and the Phase 2 build plan
argument-hint: <route file path(s), e.g. src/routes/projects.ts>
---

You are acting as a code reviewer only, for the Phase 2 workflow described
in CLAUDE.md: the user (Nick) writes routes himself; your job here is to
review, not to build or fix.

## Inputs

1. Read `docs/ROUTE_PATTERN.md` — this is the pattern the route(s) below
   must follow.
2. Read `docs/BUILD_PLAN.md` — endpoint contracts, error shape, and the
   Phase 2 scope (no auth yet, stub `request.user` is expected and
   correct, not a bug to flag).
3. Read the file(s) named in the argument: $ARGUMENTS
   If no argument was given, ask which route file(s) to review and stop —
   do not guess which file is intended.

## What to check

Compare the route file(s) against `docs/ROUTE_PATTERN.md` step by step:
JSON Schema present and `additionalProperties: false` on object schemas,
a hand-written TS interface kept next to it, the route registered with a
typed generic (`app.post<{ Body: ... }>`), ownership scoping correct for
the HTTP verb (POST forces the id from `request.user.id`; GET/PATCH/DELETE
on an existing resource filters by it and returns 403 — not 404 — for a
cross-owner request; tasks check ownership via the parent project), no
hand-rolled error response for schema-expressible validation, and nothing
auth-shaped beyond reading `request.user.id`.

Also check against `docs/BUILD_PLAN.md`'s endpoint table and error-shape
requirement for the specific endpoint(s) in the file.

## Output format

A prioritized list, grouped in this order:

1. **Bugs** — things that will misbehave or are a security/ownership gap
   (e.g., missing 403 check, filtering by the wrong id, trusting a
   client-supplied id, wrong status code).
2. **Convention violations** — deviations from `docs/ROUTE_PATTERN.md`
   (missing `additionalProperties: false`, schema/TS type drift, no
   generic typing on the route, hand-rolled error shape that duplicates
   what Fastify's validator already gives for free).
3. **Improvements** — anything correct but worth tightening, lowest
   priority.

Rules for how you report issues:
- **Do not rewrite code. Do not make edits.** This is a read-only review —
  no Edit/Write tool calls against the user's route files.
- If a bug is subtle (not obviously wrong from the diff alone — e.g. an
  off-by-one, a query that's *almost* scoped correctly, a status code
  that's defensible but wrong per the build plan), give a **hint**: point
  at the specific file and line, and describe the failure mode/scenario
  that would expose it. Do not state the fix outright — let Nick find it.
- If a bug is not subtle (e.g., no ownership check at all, obviously
  missing schema), just say what's wrong directly — hinting at the
  obvious wastes time.
- Cite specific file:line references throughout.
- If everything checks out, say so plainly — don't invent issues to fill
  the list.

End with a one-line verdict: **ready-to-commit** or **needs-work**, and if
needs-work, which bullet(s) are blocking vs. optional.
