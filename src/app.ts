import Fastify, { type FastifyInstance } from 'fastify';
import { registerBearerAuth } from './plugins/bearer-auth.js';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    ajv: {
      customOptions: { coerceTypes: false },
    },
    logger: true,
  });

  registerBearerAuth(app);

  app.get('/health', { config: { public: true } }, async () => {
    return { status: 'ok' };
  });

  void app.register(authRoutes);
  void app.register(projectRoutes);
  void app.register(taskRoutes);

  return app;
}
