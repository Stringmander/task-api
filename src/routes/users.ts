import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { sendError } from '../lib/http-errors.js';

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
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
        })
        .from(users)
        .where(eq(users.id, request.user.id));

      if (!user) {
        return sendError(reply, 401, 'User not found');
      }

      reply.code(200).send(user);
    },
  );
}
