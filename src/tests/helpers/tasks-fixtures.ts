import type { FastifyInstance } from 'fastify';
import type { UpdateTaskBody, TaskPriority, TaskStatus } from '../../routes/tasks.js';
import { createTestProject } from './projects-fixtures.js';
import { expectSuccess } from './http-assertions.js';

export async function createTestTask(app: FastifyInstance, overrides: UpdateTaskBody = {}) {
  const { owner, project } = await createTestProject(app);

  const payload = {
    title: 'Write auth middleware',
    description: 'JWT verification preHandler for protected routes',
    status: 'in_progress',
    priority: 'high',
    dueDate: '2026-09-15',
    position: 1,
    ...overrides,
  };

  const response = await app.inject({
    method: 'POST',
    url: `/projects/${project.id}/tasks`,
    headers: { authorization: `Bearer ${owner.accessToken}` },
    payload,
  });

  expectSuccess(response, 201);

  const body = response.json() as {
    id: number;
    projectId: number;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueDate: string | null;
    position: number;
    createdAt: string;
    updatedAt: string;
  };

  return { owner, project, task: body };
}
