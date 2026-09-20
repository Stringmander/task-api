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

  // { ...owner, project }, not a flat merge of everything: POST /projects's
  // response already has its own userId field (the project's owner), which
  // would silently collide with owner's userId (whoever is actually logged
  // in) if both were spread into one flat object. Keeping `project` nested
  // means a caller can compare the two independently - e.g. asserting a
  // project's userId matches the id of whoever created it - instead of
  // losing one value to whichever happened to spread last.
  return { ...owner, project: body };
}
