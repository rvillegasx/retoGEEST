import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { AppError } from "./utils/errors.js";
import { healthRoutes } from "./routes/health.js";
import { taskRoutes } from "./routes/tasks.js";
import { userRoutes } from "./routes/users.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message },
      });
      return;
    }

    // Fastify request validation (route JSON schema) errors carry a 4xx statusCode.
    if (error.statusCode && error.statusCode < 500) {
      reply.status(error.statusCode).send({
        error: { code: "BAD_REQUEST", message: error.message },
      });
      return;
    }

    request.log.error(error);
    reply.status(500).send({
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error" },
    });
  });

  app.register(healthRoutes);
  app.register(userRoutes);
  app.register(taskRoutes);

  return app;
}
