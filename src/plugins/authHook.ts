import type { FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

// Public so uptime monitors (and the platform's own health probe) don't need a key.
const PUBLIC_PATHS = new Set(["/health"]);

export async function authenticateRequest(request: FastifyRequest): Promise<void> {
  const path = request.url.split("?")[0];
  if (path && PUBLIC_PATHS.has(path)) return;

  const header = request.headers["x-api-key"];
  const providedKey = Array.isArray(header) ? header[0] : header;

  if (providedKey !== env.apiKey) {
    throw new AppError(401, "UNAUTHORIZED", "missing or invalid x-api-key header");
  }
}
