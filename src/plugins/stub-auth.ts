import type { FastifyInstance } from 'fastify';

// Augment Fastify's request type so `request.user` is known everywhere a
// route handler reads it, instead of every handler casting `request` itself.
// Phase 3 keeps this same shape (`{ id: number }`) — only *how* it gets
// populated changes (jose-verified JWT instead of a header), so route code
// written against `request.user.id` during Phase 2 does not change later.
declare module 'fastify' {
  interface FastifyRequest {
    user: { id: number };
  }
}

/**
 * TEMPORARY (Phase 2 only, per docs/BUILD_PLAN.md).
 *
 * Every owner-scoped route needs *some* value in `request.user.id` to filter
 * queries against — that's the whole point of building ownership scoping
 * before auth exists, so the pattern is proven once and every later route
 * just reuses it. Real auth (bcryptjs + jose, fail-closed Bearer-token
 * verification per CLAUDE.md's Auth Contract) lands in Phase 3 and this
 * file is deleted wholesale, not edited — nothing that depends on
 * `request.user` should need to change.
 *
 * Because there's no login yet, "who is making this request" has to come
 * from somewhere else during manual testing: an `x-stub-user-id` header,
 * defaulting to `1` so curl'ing without it still works. This is
 * intentionally easy to spot as fake — a real auth failure mode (missing
 * token) must never silently resolve to a valid user the way this does.
 */
export function registerStubAuth(app: FastifyInstance): void {
  app.decorateRequest('user');

  app.addHook('preHandler', async (request) => {
    const header = request.headers['x-stub-user-id'];
    const stubId = Array.isArray(header) ? header[0] : header;
    request.user = { id: stubId ? Number(stubId) : 1 };
  });
}
