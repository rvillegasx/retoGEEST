import type { FastifyInstance } from "fastify";
import { createUser, listUsers, type CreateUserInput } from "../repositories/usersRepository.js";
import { ConflictError, ValidationError } from "../utils/errors.js";

interface CreateUserBody {
  name?: unknown;
  lastName?: unknown;
  email?: unknown;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseCreateUserBody(body: CreateUserBody): CreateUserInput {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (!name) throw new ValidationError("name is required", "MISSING_FIELD");
  if (!lastName) throw new ValidationError("lastName is required", "MISSING_FIELD");
  if (!email) throw new ValidationError("email is required", "MISSING_FIELD");
  if (!EMAIL_REGEX.test(email)) {
    throw new ValidationError("email is not a valid email address", "INVALID_EMAIL");
  }

  return { name, lastName, email };
}

function isDuplicateEmailError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ER_DUP_ENTRY";
}

export async function userRoutes(app: FastifyInstance) {
  app.post("/users", async (request, reply) => {
    const input = parseCreateUserBody((request.body ?? {}) as CreateUserBody);

    try {
      const user = await createUser(input);
      reply.status(201).send(user);
    } catch (err) {
      if (isDuplicateEmailError(err)) {
        throw new ConflictError("email is already registered", "EMAIL_ALREADY_REGISTERED");
      }
      throw err;
    }
  });

  app.get("/users", async () => {
    const users = await listUsers();
    return users.map((user) => ({ ...user, pendingTasks: [] }));
  });
}
