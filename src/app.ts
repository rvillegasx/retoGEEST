import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { getRateLimitConfig } from "./config/env.js";
import { authenticateRequest } from "./plugins/authHook.js";
import { healthRoutes } from "./routes/health.js";
import { taskRoutes } from "./routes/tasks.js";
import { userRoutes } from "./routes/users.js";
import { AppError } from "./utils/errors.js";

export function buildApp(): FastifyInstance {
  // trustProxy: rate limiting keys by request.ip, which otherwise resolves to
  // Dokploy's reverse-proxy address for every client behind it in production.
  const app = Fastify({ logger: true, trustProxy: true });

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

  const rateLimitConfig = getRateLimitConfig();
  app.register(rateLimit, {
    max: rateLimitConfig.max,
    timeWindow: rateLimitConfig.timeWindow,
    // Default keyGenerator (by request.ip) — this API uses a single shared
    // API key today, so IP is what actually distinguishes real clients.
    // @fastify/rate-limit throws whatever this returns (see its source), so
    // returning an AppError makes it flow through our own setErrorHandler
    // with the standard { error: { code, message } } shape.
    errorResponseBuilder: (_request, context) =>
      new AppError(429, "RATE_LIMIT_EXCEEDED", `Too many requests, retry in ${context.after}`),
  });

  app.addHook("onRequest", authenticateRequest);

  app.register(healthRoutes);
  app.register(userRoutes);
  app.register(taskRoutes);

  return app;
}
