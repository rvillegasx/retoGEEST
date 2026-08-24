import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { closeDbPool, resetDatabase } from "./helpers/db.js";

async function createUser(app: ReturnType<typeof buildApp>, email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/users",
    payload: { name: "Test", lastName: "User", email },
  });
  return response.json().id as number;
}

async function createTask(app: ReturnType<typeof buildApp>, title = "Task") {
  const response = await app.inject({ method: "POST", url: "/tasks", payload: { title } });
  return response.json().id as number;
}

describe("Task assignment and completion", () => {
  const app = buildApp();

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await closeDbPool();
  });

  it("assigns users to a task", async () => {
    const userId = await createUser(app, "a@example.com");
    const taskId = await createTask(app);

    const response = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/assign`,
      payload: { userIds: [userId] },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.assignedUsers).toHaveLength(1);
    expect(body.assignedUsers[0]).toMatchObject({ id: userId, completed: false });
  });

  it("does not duplicate the relation when a user is already assigned", async () => {
    const userId = await createUser(app, "a@example.com");
    const taskId = await createTask(app);

    await app.inject({ method: "POST", url: `/tasks/${taskId}/assign`, payload: { userIds: [userId] } });
    const response = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/assign`,
      payload: { userIds: [userId] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().assignedUsers).toHaveLength(1);
  });

  it("returns TASK_NOT_FOUND when assigning to a nonexistent task", async () => {
    const userId = await createUser(app, "a@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/tasks/999999/assign",
      payload: { userIds: [userId] },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("TASK_NOT_FOUND");
  });

  it("returns USER_NOT_FOUND when assigning a nonexistent user", async () => {
    const taskId = await createTask(app);

    const response = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/assign`,
      payload: { userIds: [999999] },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("USER_NOT_FOUND");
  });

  it("marks a user's part as completed", async () => {
    const userId = await createUser(app, "a@example.com");
    const taskId = await createTask(app);
    await app.inject({ method: "POST", url: `/tasks/${taskId}/assign`, payload: { userIds: [userId] } });

    const response = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/complete`,
      payload: { userId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().taskStatus).toBe("archived");
  });

  it("archives the task only once all assigned users have completed", async () => {
    const userA = await createUser(app, "a@example.com");
    const userB = await createUser(app, "b@example.com");
    const taskId = await createTask(app);
    await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/assign`,
      payload: { userIds: [userA, userB] },
    });

    const first = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/complete`,
      payload: { userId: userA },
    });
    expect(first.json().taskStatus).toBe("open");

    const second = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/complete`,
      payload: { userId: userB },
    });
    expect(second.json().taskStatus).toBe("archived");

    const taskResponse = await app.inject({ method: "GET", url: `/tasks/${taskId}` });
    const task = taskResponse.json();
    expect(task.status).toBe("archived");
    expect(task.assignedUsers.every((u: { completed: boolean }) => u.completed)).toBe(true);
  });

  it("returns USER_NOT_ASSIGNED when completing without an assignment", async () => {
    const userId = await createUser(app, "a@example.com");
    const taskId = await createTask(app);

    const response = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/complete`,
      payload: { userId },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("USER_NOT_ASSIGNED");
  });

  it("returns TASK_NOT_FOUND when completing a nonexistent task", async () => {
    const userId = await createUser(app, "a@example.com");

    const response = await app.inject({
      method: "POST",
      url: "/tasks/999999/complete",
      payload: { userId },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("TASK_NOT_FOUND");
  });

  it("returns USER_NOT_FOUND when completing with a nonexistent user", async () => {
    const taskId = await createTask(app);

    const response = await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/complete`,
      payload: { userId: 999999 },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("USER_NOT_FOUND");
  });

  it("lists a user's assigned tasks with completion state via GET /users/:idUser/tasks", async () => {
    const userId = await createUser(app, "a@example.com");
    const taskId = await createTask(app, "Task A");
    await app.inject({ method: "POST", url: `/tasks/${taskId}/assign`, payload: { userIds: [userId] } });

    const response = await app.inject({ method: "GET", url: `/users/${userId}/tasks` });

    expect(response.statusCode).toBe(200);
    const tasks = response.json();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: taskId, title: "Task A", completed: false });
  });

  it("returns USER_NOT_FOUND for GET /users/:idUser/tasks with a nonexistent user", async () => {
    const response = await app.inject({ method: "GET", url: "/users/999999/tasks" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("USER_NOT_FOUND");
  });

  it("reflects pending tasks in GET /users", async () => {
    const userId = await createUser(app, "a@example.com");
    const taskId = await createTask(app, "Task A");
    await app.inject({ method: "POST", url: `/tasks/${taskId}/assign`, payload: { userIds: [userId] } });

    const response = await app.inject({ method: "GET", url: "/users" });
    const users = response.json();
    const user = users.find((u: { id: number }) => u.id === userId);

    expect(user.pendingTasks).toHaveLength(1);
    expect(user.pendingTasks[0].id).toBe(taskId);
  });
});
