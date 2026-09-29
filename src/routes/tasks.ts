import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tasks } from '../db/schema.js';
import { sendError } from '../lib/http-errors.js';
import { idParamSchema, IdParams } from '../lib/params.js';
import { findOwnedProject, findOwnedTask } from '../lib/ownership.js';

const taskStatusEnum = ['todo', 'in_progress', 'done'] as const;
const taskPriorityEnum = ['low', 'medium', 'high'] as const;

const createTaskBodySchema = {
  type: 'object',
  required: ['title'],
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: ['string', 'null'] },
    status: { type: 'string', enum: taskStatusEnum },
    priority: { type: 'string', enum: taskPriorityEnum },
    dueDate: { type: ['string', 'null'], format: 'date' },
    position: { type: 'integer' },
  },
} as const;

const updateTaskBodySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 100 },
    description: { type: ['string', 'null'] },
    status: { type: 'string', enum: taskStatusEnum },
    priority: { type: 'string', enum: taskPriorityEnum },
    dueDate: { type: ['string', 'null'], format: 'date' },
    position: { type: 'integer' },
  },
} as const;

// Derived from the const arrays above via indexed access on `typeof`, not
// hand-typed: `taskStatusEnum` is `readonly ['todo', 'in_progress', 'done']`
// (the `as const`), and `(typeof taskStatusEnum)[number]` reads as "the
// type of whatever indexing this array with a number produces" - the union
// of its literal elements. One list to edit, not two that could drift.
export type TaskStatus = (typeof taskStatusEnum)[number];
export type TaskPriority = (typeof taskPriorityEnum)[number];

interface CreateTaskBody {
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate?: string | null;
  position: number;
}

export type UpdateTaskBody = Partial<CreateTaskBody>;

// Matches every column .returning() actually returns from `tasks`
// (schema.ts) - no more, no less. Unlike the body schemas above,
// additionalProperties: false isn't needed here: a response schema doesn't
// reject anything, it's a serialization whitelist - Fastify only writes out
// the properties listed here regardless of that flag, silently dropping
// whatever else the handler returned. A field missing here disappears from
// the real response, not just from openapi.yaml.
// required lists every property, including the nullable ones - see the
// equivalent comment on projectResponseSchema in projects.ts for why
// (nullable still means always-present-as-a-key, and Fastify enforces this
// at runtime, not just in the generated spec).
const taskResponseSchema = {
  $id: 'taskResponseSchema',
  description: 'A task',
  type: 'object',
  required: [
    'id',
    'projectId',
    'title',
    'description',
    'status',
    'priority',
    'dueDate',
    'position',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: { type: 'integer' },
    projectId: { type: 'integer' },
    title: { type: 'string' },
    description: { type: ['string', 'null'] },
    status: { type: 'string', enum: taskStatusEnum },
    priority: { type: 'string', enum: taskPriorityEnum },
    dueDate: { type: ['string', 'null'] },
    position: { type: 'integer' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
} as const;

const tasksResponseSchema = {
  description: 'A list of tasks',
  type: 'array',
  items: { $ref: 'taskResponseSchema' },
} as const;

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // A schema's `$id` doesn't register it anywhere by itself - it's just a
  // property on the object. addSchema is what actually makes it resolvable
  // by $ref: 'taskResponseSchema' below, and it has to run before any
  // route that references it is registered.
  app.addSchema(taskResponseSchema);

  app.get<{ Params: IdParams }>(
    '/projects/:id/tasks',
    {
      schema: {
        params: idParamSchema,
        response: { 200: tasksResponseSchema },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      // Safe as a plain Number(): idParamSchema's pattern caps id at 15
      // digits, well under Number.MAX_SAFE_INTEGER, and the id column is a
      // bigserial declared with `mode: 'number'` — so this is the conversion
      // Drizzle expects, not a precision-losing shortcut.
      const projectId = Number(request.params.id);

      // Tasks don't store user_id — ownership is transitive through the parent
      // project, so it has to be checked with its own query before the insert,
      // not inferred from the task row itself.
      const project = await findOwnedProject(request.user.id, projectId);

      // 403, never 404: a combined id+userId WHERE can't tell "doesn't exist"
      // from "someone else's project" apart, and docs/ROUTE_PATTERN.md wants
      // it that way — a 404 here would confirm the id exists at all.
      if (!project) {
        return sendError(reply, 403, 'Project not found');
      }

      const projectTasks = await db.select().from(tasks).where(eq(tasks.projectId, projectId));

      reply.code(200).send(projectTasks);
    },
  );

  app.post<{ Body: CreateTaskBody; Params: IdParams }>(
    '/projects/:id/tasks',
    {
      schema: {
        body: createTaskBodySchema,
        params: idParamSchema,
        response: { 201: taskResponseSchema },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { title, description, status, priority, dueDate, position } = request.body;
      const projectId = Number(request.params.id);

      const project = await findOwnedProject(request.user.id, projectId);

      if (!project) {
        return sendError(reply, 403, 'Project not found');
      }

      const [task] = await db
        .insert(tasks)
        .values({
          projectId,
          title,
          description: description ?? null,
          status: status ?? 'todo',
          priority: priority ?? 'medium',
          dueDate: dueDate ?? null,
          position: position ?? 0,
        })
        .returning();

      reply.code(201).send(task);
    },
  );

  app.get<{ Params: IdParams }>(
    '/tasks/:id',
    {
      schema: {
        params: idParamSchema,
        response: { 200: taskResponseSchema },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const taskId = Number(request.params.id);

      const task = await findOwnedTask(request.user.id, taskId);
      if (!task) {
        return sendError(reply, 403, 'Task not found');
      }

      reply.code(200).send(task);
    },
  );

  app.patch<{ Body: UpdateTaskBody; Params: IdParams }>(
    '/tasks/:id',
    {
      schema: {
        body: updateTaskBodySchema,
        params: idParamSchema,
        response: { 200: taskResponseSchema },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const { title, description, status, priority, dueDate, position } = request.body;
      const taskId = Number(request.params.id);

      const existingTask = await findOwnedTask(request.user.id, taskId);
      if (!existingTask) {
        return sendError(reply, 403, 'Task not found');
      }

      // A field the client omitted comes through as undefined here (the
      // schema has no `required`), and Drizzle's .set() skips undefined keys
      // rather than writing SQL NULL. That's what makes this a true partial
      // update instead of clobbering omitted columns.
      const [task] = await db
        .update(tasks)
        .set({ title, description, status, priority, dueDate, position })
        .where(eq(tasks.id, taskId))
        .returning();

      reply.code(200).send(task);
    },
  );

  app.delete<{ Params: IdParams }>(
    '/tasks/:id',
    // { type: 'null' }, not a bare `null` - see the DELETE /projects/:id
    // comment in projects.ts for why (a bare null crashes the app at boot).
    {
      schema: {
        params: idParamSchema,
        response: { 204: { type: 'null', description: 'No content' } },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request, reply) => {
      const taskId = Number(request.params.id);

      const existingTask = await findOwnedTask(request.user.id, taskId);
      if (!existingTask) {
        return sendError(reply, 403, 'Task not found');
      }

      await db.delete(tasks).where(eq(tasks.id, taskId));

      reply.code(204).send();
    },
  );
}
