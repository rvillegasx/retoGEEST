import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app.js";
import { closeDbPool, resetDatabase } from "./helpers/db.js";

describe("Tasks", () => {
  const app = buildTestApp();

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await closeDbPool();
  });

  it("creates a task via POST /tasks with default status open", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "Write report", description: "Q3 summary" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      title: "Write report",
      description: "Q3 summary",
      status: "open",
      assignedUsers: [],
    });
    expect(typeof body.id).toBe("number");
  });

  it("allows creating a task without a description", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "Write report" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().description).toBeNull();
  });

  it("returns MISSING_FIELD when title is missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { description: "no title here" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("MISSING_FIELD");
  });

  it("lists tasks via GET /tasks", async () => {
    await app.inject({ method: "POST", url: "/tasks", payload: { title: "Task A" } });
    await app.inject({ method: "POST", url: "/tasks", payload: { title: "Task B" } });

    const response = await app.inject({ method: "GET", url: "/tasks" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(2);
  });

  it("filters tasks by status via GET /tasks?status=open", async () => {
    await app.inject({ method: "POST", url: "/tasks", payload: { title: "Task A" } });

    const response = await app.inject({ method: "GET", url: "/tasks?status=open" });

    expect(response.statusCode).toBe(200);
    const tasks = response.json();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("open");
  });

  it("returns empty list for GET /tasks?status=archived when none are archived", async () => {
    await app.inject({ method: "POST", url: "/tasks", payload: { title: "Task A" } });

    const response = await app.inject({ method: "GET", url: "/tasks?status=archived" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it("rejects an invalid status query param", async () => {
    const response = await app.inject({ method: "GET", url: "/tasks?status=bogus" });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_QUERY_PARAM");
  });

  it("returns full task info via GET /tasks/:idTask", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "Task A", description: "details" },
    });
    const { id } = created.json();

    const response = await app.inject({ method: "GET", url: `/tasks/${id}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id,
      title: "Task A",
      description: "details",
      status: "open",
      assignedUsers: [],
    });
  });

  it("returns TASK_NOT_FOUND for a nonexistent task", async () => {
    const response = await app.inject({ method: "GET", url: "/tasks/999999" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("TASK_NOT_FOUND");
  });
});
