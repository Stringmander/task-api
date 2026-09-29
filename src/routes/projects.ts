import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { projects } from '../db/schema.js';
import { sendError } from '../lib/http-errors.js';
import { idParamSchema, IdParams } from '../lib/params.js';
import { findOwnedProject } from '../lib/ownership.js';

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

const updateProjectBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: ['string', 'null'] },
  },
} as const;

// Matches every column .returning() actually returns from `projects`
// (schema.ts) - no more, no less. Unlike the body schemas above,
// additionalProperties: false isn't needed here: a response schema doesn't
// reject anything, it's a serialization whitelist - Fastify only writes out
// the properties listed here regardless of that flag, silently dropping
// whatever else the handler returned. That's what makes keeping this in
// sync with .returning()'s actual shape a correctness requirement, not
// just a documentation nicety - a field missing here disappears from the
// real response, not just from openapi.yaml.
// "A project", not "The created project" - this same object is response:
// 201 on POST, response: 200 on GET and PATCH, so a description tied to one
// specific operation would be wrong on the other two. The HTTP method and
// path already say what the operation is; this description's job is just
// to say what's in the body.
// required lists every property below, not just the non-nullable ones:
// "required" in JSON Schema means the key is always present, which is true
// here even for description (it's always a key on the row, just sometimes
// null-valued) - it says nothing about whether the value can be null. This
// isn't only a documentation nicety either: Fastify's response serializer
// enforces it at runtime, throwing a 500 if a handler ever actually omits
// a field listed here (verified by hand), so it doubles as a guarantee
// that this list and .returning()'s actual shape can't silently drift.
const projectResponseSchema = {
  $id: 'projectResponseSchema',
  description: 'A project',
  type: 'object',
  required: ['id', 'userId', 'name', 'description', 'createdAt', 'updatedAt'],
  properties: {
    id: { type: 'integer' },
    userId: { type: 'integer' },
    name: { type: 'string' },
    description: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;

const projectsResponseSchema = {
  description: 'A list of projects',
  type: 'array',
  items: { $ref: 'projectResponseSchema' },
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

export type UpdateProjectBody = Partial<CreateProjectBody>;

export async function projectRoutes(app: FastifyInstance): Promise<void> {
  // A schema's `$id` doesn't register it anywhere by itself - it's just a
  // property on the object. addSchema is what actually makes it resolvable
  // by $ref: 'projectResponseSchema' below, and it has to run before any
  // route that references it is registered.
  app.addSchema(projectResponseSchema);

  app.get(
    '/projects',
    { schema: { response: { 200: projectsResponseSchema } } },
    async (request, reply) => {
      const userProjects = await db
        .select()
        .from(projects)
        .where(eq(projects.userId, request.user.id));

      reply.code(200).send(userProjects);
    },
  );

  app.post<{ Body: CreateProjectBody }>(
    '/projects',
    { schema: { body: createProjectBodySchema, response: { 201: projectResponseSchema } } },
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

  app.get<{ Params: IdParams }>(
    '/projects/:id',
    { schema: { params: idParamSchema, response: { 200: projectResponseSchema } } },
    async (request, reply) => {
      // Safe as a plain Number(): idParamSchema's pattern caps id at 15
      // digits, well under Number.MAX_SAFE_INTEGER, and the id column is a
      // bigserial declared with `mode: 'number'` — so this is the conversion
      // Drizzle expects, not a precision-losing shortcut.
      const id = Number(request.params.id);

      const project = await findOwnedProject(request.user.id, id);

      // 403, never 404: a combined id+userId WHERE can't tell "doesn't exist"
      // from "someone else's project" apart, and docs/ROUTE_PATTERN.md wants
      // it that way — a 404 here would confirm the id exists at all.
      if (!project) {
        return sendError(reply, 403, 'Project not found');
      }

      reply.code(200).send(project);
    },
  );

  app.patch<{ Body: UpdateProjectBody; Params: IdParams }>(
    '/projects/:id',
    {
      schema: {
        body: updateProjectBodySchema,
        params: idParamSchema,
        response: { 200: projectResponseSchema },
      },
    },
    async (request, reply) => {
      const { name, description } = request.body;
      const id = Number(request.params.id);

      // A field the client omitted comes through as undefined here (the
      // schema has no `required`), and Drizzle's .set() skips undefined keys
      // rather than writing SQL NULL — confirmed by hand against `name` and
      // 'description', which is NOT NULL in the schema. That's what makes this
      // a true partial update instead of clobbering omitted columns.
      const [project] = await db
        .update(projects)
        .set({
          name,
          description,
        })
        .where(and(eq(projects.id, id), eq(projects.userId, request.user.id)))
        .returning();

      if (!project) {
        return sendError(reply, 403, 'Project not found');
      }

      reply.code(200).send(project);
    },
  );

  app.delete<{ Params: IdParams }>(
    '/projects/:id',
    // { type: 'null' }, not a bare `null` - a bare `null` isn't a valid JSON
    // Schema at all and crashes the app at boot (verified by hand:
    // "Cannot read properties of null (reading 'isFluentSchema')"). This form
    // both matches the handler's actual empty reply.code(204).send() and
    // makes @fastify/swagger correctly omit the `content` block for this
    // response in openapi.yaml, rather than claiming a body that isn't there.
    { schema: { params: idParamSchema, response: { 204: { type: 'null', description: 'No content' } } } },
    async (request, reply) => {
      const id = Number(request.params.id);

      const [project] = await db
        .delete(projects)
        .where(and(eq(projects.id, id), eq(projects.userId, request.user.id)))
        .returning();

      if (!project) {
        return sendError(reply, 403, 'Project not found');
      }

      reply.code(204).send();
    },
  );
}
