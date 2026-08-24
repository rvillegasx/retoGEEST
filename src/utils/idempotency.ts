import type { FastifyReply, FastifyRequest } from "fastify";
import {
  completeRecord,
  deleteRecord,
  getRecord,
  tryClaim,
} from "../repositories/idempotencyRepository.js";
import { AppError, ConflictError } from "./errors.js";
import { hashRequestBody } from "./hash.js";

export interface HandlerResult<T = unknown> {
  statusCode: number;
  body: T;
}

const POLL_INTERVAL_MS = 50;
const POLL_TIMEOUT_MS = 5000;
// If a claim sits "in_progress" longer than this, assume the owning request
// crashed and let it be retried instead of waiting forever.
const STALE_LOCK_MS = 30000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `handler` under an Idempotency-Key contract when the client sends one:
 * concurrent/duplicate requests with the same key and body execute the
 * handler exactly once and receive identical responses. Without the header,
 * behaves like a normal (non-idempotent) request.
 */
export async function withIdempotency(
  request: FastifyRequest,
  reply: FastifyReply,
  handler: () => Promise<HandlerResult>,
): Promise<void> {
  const header = request.headers["idempotency-key"];
  const idempotencyKey = Array.isArray(header) ? header[0] : header;

  if (!idempotencyKey) {
    const result = await handler();
    reply.status(result.statusCode).send(result.body);
    return;
  }

  const method = request.method;
  const path = request.url.split("?")[0] ?? request.url;
  const requestHash = hashRequestBody(request.body);

  const result = await executeIdempotent(idempotencyKey, method, path, requestHash, handler);
  reply.status(result.statusCode).send(result.body);
}

async function executeIdempotent(
  key: string,
  method: string,
  path: string,
  requestHash: string,
  handler: () => Promise<HandlerResult>,
): Promise<HandlerResult> {
  const claimed = await tryClaim(key, method, path, requestHash);

  if (claimed) {
    try {
      const result = await handler();
      await completeRecord(key, method, path, result.statusCode, result.body);
      return result;
    } catch (err) {
      if (err instanceof AppError) {
        const result: HandlerResult = {
          statusCode: err.statusCode,
          body: { error: { code: err.code, message: err.message } },
        };
        await completeRecord(key, method, path, result.statusCode, result.body);
        return result;
      }
      // Unexpected (non-AppError) failure: release the claim so a retry can try again.
      await deleteRecord(key, method, path);
      throw err;
    }
  }

  return waitForResult(key, method, path, requestHash);
}

async function waitForResult(
  key: string,
  method: string,
  path: string,
  requestHash: string,
  elapsed = 0,
): Promise<HandlerResult> {
  const record = await getRecord(key, method, path);

  if (!record) {
    throw new ConflictError(
      "Idempotency-Key was being processed by a request that failed; retry",
      "IDEMPOTENCY_KEY_IN_PROGRESS",
    );
  }

  if (record.requestHash !== requestHash) {
    throw new ConflictError(
      "Idempotency-Key was already used with a different request body",
      "IDEMPOTENCY_KEY_REUSED",
    );
  }

  if (record.status === "completed" && record.responseStatus !== null) {
    return { statusCode: record.responseStatus, body: record.responseBody };
  }

  if (Date.now() - record.createdAt.getTime() > STALE_LOCK_MS) {
    await deleteRecord(key, method, path);
    throw new ConflictError(
      "Idempotency-Key lock was abandoned by a crashed request; retry",
      "IDEMPOTENCY_KEY_IN_PROGRESS",
    );
  }

  if (elapsed >= POLL_TIMEOUT_MS) {
    throw new ConflictError(
      "Timed out waiting for the concurrent request with this Idempotency-Key to finish",
      "IDEMPOTENCY_KEY_TIMEOUT",
    );
  }

  await sleep(POLL_INTERVAL_MS);
  return waitForResult(key, method, path, requestHash, elapsed + POLL_INTERVAL_MS);
}
