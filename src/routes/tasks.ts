import type { FastifyInstance } from "fastify";
import {
  assignUsersToTask,
  countIncompleteAssignments,
  getAssignedUsersForTask,
  getAssignedUsersForTasks,
  getAssignmentStatus,
  getExistingUserIds,
  markAssignmentCompleted,
} from "../repositories/taskAssignmentsRepository.js";
import {
  archiveTask,
  createTask,
  getTaskById,
  listTasks,
  type CreateTaskInput,
  type TaskStatus,
} from "../repositories/tasksRepository.js";
import { getUserById } from "../repositories/usersRepository.js";
import { ConflictError, NotFoundError, ValidationError } from "../utils/errors.js";
import { withIdempotency } from "../utils/idempotency.js";
import { parsePositiveIntParam } from "../utils/params.js";

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

function parseUserIdsBody(userIds: unknown): number[] {
  if (userIds === undefined) {
    throw new ValidationError("userIds is required", "MISSING_FIELD");
  }
  if (!Array.isArray(userIds) || userIds.length === 0) {
    throw new ValidationError("userIds must be a non-empty array", "INVALID_FIELD");
  }
  const ids = userIds.map((id) => {
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
      throw new ValidationError("userIds must contain positive integers", "INVALID_FIELD");
    }
    return id;
  });
  return Array.from(new Set(ids));
}

function parseUserIdBody(userId: unknown): number {
  if (userId === undefined) {
    throw new ValidationError("userId is required", "MISSING_FIELD");
  }
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) {
    throw new ValidationError("userId must be a positive integer", "INVALID_FIELD");
  }
  return userId;
}

export async function taskRoutes(app: FastifyInstance) {
  app.post("/tasks", async (request, reply) => {
    await withIdempotency(request, reply, async () => {
      const input = parseCreateTaskBody((request.body ?? {}) as CreateTaskBody);
      const task = await createTask(input);
      return { statusCode: 201, body: { ...task, assignedUsers: [] } };
    });
  });

  app.get("/tasks", async (request) => {
    const query = request.query as { status?: unknown };
    const status = parseStatusQuery(query.status);
    const tasks = await listTasks(status);
    const assignedMap = await getAssignedUsersForTasks(tasks.map((task) => task.id));
    return tasks.map((task) => ({ ...task, assignedUsers: assignedMap.get(task.id) ?? [] }));
  });

  app.get("/tasks/:idTask", async (request) => {
    const params = request.params as { idTask: string };
    const idTask = parsePositiveIntParam(params.idTask, "idTask");

    const task = await getTaskById(idTask);
    if (!task) throw new NotFoundError("task not found", "TASK_NOT_FOUND");

    const assignedUsers = await getAssignedUsersForTask(idTask);
    return { ...task, assignedUsers };
  });

  app.post("/tasks/:idTask/assign", async (request, reply) => {
    await withIdempotency(request, reply, async () => {
      const params = request.params as { idTask: string };
      const idTask = parsePositiveIntParam(params.idTask, "idTask");
      const body = (request.body ?? {}) as { userIds?: unknown };
      const userIds = parseUserIdsBody(body.userIds);

      const task = await getTaskById(idTask);
      if (!task) throw new NotFoundError("task not found", "TASK_NOT_FOUND");

      const existingIds = new Set(await getExistingUserIds(userIds));
      const missingIds = userIds.filter((id) => !existingIds.has(id));
      if (missingIds.length > 0) {
        throw new NotFoundError(`user(s) not found: ${missingIds.join(", ")}`, "USER_NOT_FOUND");
      }

      await assignUsersToTask(idTask, userIds);

      const assignedUsers = await getAssignedUsersForTask(idTask);
      return { statusCode: 200, body: { message: "users assigned to task", assignedUsers } };
    });
  });

  app.post("/tasks/:idTask/complete", async (request, reply) => {
    await withIdempotency(request, reply, async () => {
      const params = request.params as { idTask: string };
      const idTask = parsePositiveIntParam(params.idTask, "idTask");
      const body = (request.body ?? {}) as { userId?: unknown };
      const userId = parseUserIdBody(body.userId);

      const task = await getTaskById(idTask);
      if (!task) throw new NotFoundError("task not found", "TASK_NOT_FOUND");

      const user = await getUserById(userId);
      if (!user) throw new NotFoundError("user not found", "USER_NOT_FOUND");

      const assignment = await getAssignmentStatus(idTask, userId);
      if (!assignment) {
        throw new ConflictError("user is not assigned to this task", "USER_NOT_ASSIGNED");
      }

      await markAssignmentCompleted(idTask, userId);

      const remaining = await countIncompleteAssignments(idTask);
      if (remaining === 0) {
        await archiveTask(idTask);
      }

      const updatedTask = await getTaskById(idTask);
      return {
        statusCode: 200,
        body: {
          message: "task marked as completed for user",
          taskId: idTask,
          userId,
          taskStatus: updatedTask?.status ?? task.status,
        },
      };
    });
  });
}
