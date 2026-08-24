import type { FastifyInstance } from "fastify";
import {
  createTask,
  getTaskById,
  listTasks,
  type CreateTaskInput,
  type TaskStatus,
} from "../repositories/tasksRepository.js";
import { NotFoundError, ValidationError } from "../utils/errors.js";

interface CreateTaskBody {
  title?: unknown;
  description?: unknown;
}

function parseCreateTaskBody(body: CreateTaskBody): CreateTaskInput {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";

  if (!title) throw new ValidationError("title is required", "MISSING_FIELD");

  return { title, description: description || null };
}

const VALID_STATUSES: TaskStatus[] = ["open", "archived"];

function parseStatusQuery(status: unknown): TaskStatus | undefined {
  if (status === undefined) return undefined;
  if (typeof status === "string" && (VALID_STATUSES as string[]).includes(status)) {
    return status as TaskStatus;
  }
  throw new ValidationError("status must be 'open' or 'archived'", "INVALID_QUERY_PARAM");
}

function parseTaskIdParam(idTask: string): number {
  const id = Number(idTask);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError("idTask must be a positive integer", "INVALID_PARAM");
  }
  return id;
}

export async function taskRoutes(app: FastifyInstance) {
  app.post("/tasks", async (request, reply) => {
    const input = parseCreateTaskBody((request.body ?? {}) as CreateTaskBody);
    const task = await createTask(input);
    reply.status(201).send({ ...task, assignedUsers: [] });
  });

  app.get("/tasks", async (request) => {
    const query = request.query as { status?: unknown };
    const status = parseStatusQuery(query.status);
    const tasks = await listTasks(status);
    return tasks.map((task) => ({ ...task, assignedUsers: [] }));
  });

  app.get("/tasks/:idTask", async (request) => {
    const params = request.params as { idTask: string };
    const idTask = parseTaskIdParam(params.idTask);

    const task = await getTaskById(idTask);
    if (!task) throw new NotFoundError("task not found", "TASK_NOT_FOUND");

    return { ...task, assignedUsers: [] };
  });
}
