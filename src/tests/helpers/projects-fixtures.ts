import type { FastifyInstance } from 'fastify';
import { CreateProjectBody } from '../../routes/projects.js';
import { loginTestUser } from './auth-fixtures.js';
import { expectSuccess } from './http-assertions.js';

export async function createTestProject(
  app: FastifyInstance,
  overrides: Partial<CreateProjectBody> = {},
) {
  const owner = await loginTestUser(app);

  const payload = {
    name: 'Portfolio Project',
    description: 'Node.js task API for the career pivot',
    ...overrides,
  };

  const response = await app.inject({
    method: 'POST',
    url: '/projects',
    headers: { authorization: `Bearer ${owner.accessToken}` },
    payload,
  });

  expectSuccess(response, 201);

  const body = response.json() as {
    id: number;
    userId: number;
    name: string;
    description: string | null;
    createdAt: string;
    updatedAt: string;
  };

  return { ...owner, project: body };
}
