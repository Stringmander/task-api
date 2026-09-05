import Fastify, { type FastifyInstance } from 'fastify';
import { registerStubAuth } from './plugins/stub-auth.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    ajv: {
      customOptions: { coerceTypes: false },
    },
    logger: true,
  });

  // Registered before routes so request.user is populated for every
  // handler below it — see src/plugins/stub-auth.ts for why this exists
  // and what replaces it in Phase 3.
  registerStubAuth(app);

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  void app.register(projectRoutes);
  void app.register(taskRoutes);

  return app;
}
