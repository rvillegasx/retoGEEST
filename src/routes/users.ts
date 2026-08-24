import type { FastifyInstance } from "fastify";
import { getPendingTasksForUsers, getTasksForUser } from "../repositories/taskAssignmentsRepository.js";
import { createUser, getUserById, listUsers, type CreateUserInput } from "../repositories/usersRepository.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { withIdempotency } from "../utils/idempotency.js";
import { parsePositiveIntParam } from "../utils/params.js";

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
    await withIdempotency(request, reply, async () => {
      const input = parseCreateUserBody((request.body ?? {}) as CreateUserBody);

      try {
        const user = await createUser(input);
        return { statusCode: 201, body: user };
      } catch (err) {
        if (isDuplicateEmailError(err)) {
          throw new ConflictError("email is already registered", "EMAIL_ALREADY_REGISTERED");
        }
        throw err;
      }
    });
  });

  app.get("/users", async () => {
    const users = await listUsers();
    const pendingMap = await getPendingTasksForUsers(users.map((user) => user.id));
    return users.map((user) => ({ ...user, pendingTasks: pendingMap.get(user.id) ?? [] }));
  });

  app.get("/users/:idUser/tasks", async (request) => {
    const params = request.params as { idUser: string };
    const idUser = parsePositiveIntParam(params.idUser, "idUser");

    const user = await getUserById(idUser);
    if (!user) throw new NotFoundError("user not found", "USER_NOT_FOUND");

    return getTasksForUser(idUser);
  });
}
