import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { projects } from '../db/schema.js';

// Fastify validates the request body against this schema *before* the
// handler runs — invalid requests never reach our code, and the 400
// response it generates already matches the project's required error
// shape { statusCode, error, message } (see docs/BUILD_PLAN.md), so this
// route needs no manual validation or error-shaping code of its own.
//
// `additionalProperties: false` matters beyond tidiness: it's the schema
// half of "never trust client-supplied ids for ownership" (CLAUDE.md).
// Without it, a client could send `{ name, userId: 999 }` and — depending
// on how loosely the handler reads the body — smuggle in someone else's
// user id. Fastify's AJV defaults (removeAdditional: true) mean this
// doesn't even produce a 400 — `userId` is silently stripped from
// request.body before the handler sees it, rather than rejected. Verified
// by hand: POSTing `{"name":"x","userId":999}` returns 201 with the
// project owned by request.user.id, never 999. The handler reinforces the
// same property by construction — it destructures only `name`/
// `description`, so there's nothing to smuggle even if that default ever
// changed.
const createProjectBodySchema = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: ['string', 'null'] },
  },
} as const;

// Mirrors createProjectBodySchema by hand. Fastify's JSON Schema and
// TypeScript's type system are two separate worlds — nothing here proves
// they stay in sync. A JSON-Schema-to-TS provider (e.g.
// @fastify/type-provider-typebox) removes that duplication by generating
// one from the other; this project skips that dependency for now and
// simply keeps the two declarations next to each other so a change to one
// is hard to make without noticing the other.
interface CreateProjectBody {
  name: string;
  description?: string | null;
}

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateProjectBody }>(
    '/projects',
    { schema: { body: createProjectBodySchema } },
    async (request, reply) => {
      const { name, description } = request.body;

      // Ownership scoping on create isn't a WHERE clause (there's nothing to
      // filter yet) — it's *forcing* userId from the authenticated identity
      // instead of trusting anything the client sent. request.user comes
      // from the stub preHandler today and a verified JWT in Phase 3; the
      // handler code doesn't care which, because it never reads an id out
      // of the request body.
      const [project] = await db
        .insert(projects)
        .values({
          userId: request.user.id,
          name,
          description: description ?? null,
        })
        .returning();

      reply.code(201).send(project);
    },
  );
}
