import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { sendError } from '../lib/http-errors.js';

// Deliberately separate from auth.ts's own userResponseSchema, even though
// the shapes mostly overlap: they represent different things (the user
// that was just created vs. whoever a token belongs to), and they don't
// even stay identical - auth.ts's version requires createdAt, this one
// doesn't, since the frontend only needs id/email/displayName here.
// Sharing across route files would also be new territory for this
// codebase; projectResponseSchema/taskResponseSchema are only ever shared
// within one file's own routes, never across files.
const userResponseSchema = {
  description: 'The current user',
  type: 'object',
  required: ['id', 'email', 'displayName'],
  properties: {
    id: { type: 'integer' },
    email: { type: 'string' },
    displayName: { type: 'string' },
  },
} as const;

export async function userRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/users/me',
    { schema: { response: { 200: userResponseSchema }, security: [{ bearerAuth: [] }] } },
    async (request, reply) => {
      // Explicit column list, not a bare .select(): same reasoning as
      // auth.ts's register handler - passwordHash never leaves the
      // database because it's never even selected back, not because a
      // field gets stripped after the fact.
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        })
        .from(users)
        .where(eq(users.id, request.user.id));

      if (!user) {
        // 401, not 403, unlike every other "not found" in this codebase:
        // /projects/:id's 403-not-404 rule exists to stop id enumeration
        // via a client-supplied id, but nothing here is client-supplied -
        // the only way this branch is reachable is a still-valid access
        // token (unrevoked and stateless for its full 15-minute life)
        // whose user row was deleted after it was issued. That's the same
        // "credential no longer maps to anything live" problem auth.ts's
        // refresh-reuse check solves with a 401, not an ownership
        // question, so it gets the same status code.
        return sendError(reply, 401, 'User not found');
      }

      reply.code(200).send(user);
    },
  );
}
