import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app.js";
import { closeDbPool, resetDatabase } from "./helpers/db.js";

describe("Idempotency-Key", () => {
  const app = buildTestApp();

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await closeDbPool();
  });

  it("returns an identical response and creates only one resource on a sequential retry", async () => {
    const payload = { name: "Ada", lastName: "Lovelace", email: "ada@example.com" };
    const headers = { "idempotency-key": "key-1" };

    const first = await app.inject({ method: "POST", url: "/users", payload, headers });
    const second = await app.inject({ method: "POST", url: "/users", payload, headers });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());

    const list = await app.inject({ method: "GET", url: "/users" });
    expect(list.json()).toHaveLength(1);
  });

  it("executes the operation exactly once for two truly concurrent duplicate requests", async () => {
    const payload = { name: "Ada", lastName: "Lovelace", email: "ada@example.com" };
    const headers = { "idempotency-key": "key-concurrent" };

    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: "/users", payload, headers }),
      app.inject({ method: "POST", url: "/users", payload, headers }),
    ]);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());

    const list = await app.inject({ method: "GET", url: "/users" });
    expect(list.json()).toHaveLength(1);
  });

  it("returns IDEMPOTENCY_KEY_REUSED when the same key is sent with a different body", async () => {
    const headers = { "idempotency-key": "key-2" };

    const first = await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "Ada", lastName: "Lovelace", email: "ada@example.com" },
      headers,
    });
    const second = await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "Grace", lastName: "Hopper", email: "grace@example.com" },
      headers,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("replays an identical error response for a retried failing request", async () => {
    const payload = { name: "Ada", email: "not-an-email" };
    const headers = { "idempotency-key": "key-error" };

    const first = await app.inject({ method: "POST", url: "/users", payload, headers });
    const second = await app.inject({ method: "POST", url: "/users", payload, headers });

    expect(first.statusCode).toBe(400);
    expect(second.statusCode).toBe(400);
    expect(second.json()).toEqual(first.json());
  });

  it("does not apply idempotency without the header, creating separate resources", async () => {
    const payload = { name: "Ada", lastName: "Lovelace", email: "ada@example.com" };

    const first = await app.inject({ method: "POST", url: "/users", payload });
    const second = await app.inject({
      method: "POST",
      url: "/users",
      payload: { ...payload, email: "ada2@example.com" },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const list = await app.inject({ method: "GET", url: "/users" });
    expect(list.json()).toHaveLength(2);
  });

  it("keys idempotency per endpoint path, not just the header value", async () => {
    const headers = { "idempotency-key": "shared-key" };

    const userResponse = await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "Ada", lastName: "Lovelace", email: "ada@example.com" },
      headers,
    });
    const taskResponse = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "Task A" },
      headers,
    });

    expect(userResponse.statusCode).toBe(201);
    expect(taskResponse.statusCode).toBe(201);
  });

  it("applies idempotency to /tasks/:idTask/assign", async () => {
    const userResp = await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    });
    const taskResp = await app.inject({ method: "POST", url: "/tasks", payload: { title: "Task A" } });
    const userId = userResp.json().id;
    const taskId = taskResp.json().id;
    const headers = { "idempotency-key": "assign-key" };

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/tasks/${taskId}/assign`,
        payload: { userIds: [userId] },
        headers,
      }),
      app.inject({
        method: "POST",
        url: `/tasks/${taskId}/assign`,
        payload: { userIds: [userId] },
        headers,
      }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
  });

  it("applies idempotency to /tasks/:idTask/complete", async () => {
    const userResp = await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    });
    const taskResp = await app.inject({ method: "POST", url: "/tasks", payload: { title: "Task A" } });
    const userId = userResp.json().id;
    const taskId = taskResp.json().id;
    await app.inject({ method: "POST", url: `/tasks/${taskId}/assign`, payload: { userIds: [userId] } });

    const headers = { "idempotency-key": "complete-key" };
    const [first, second] = await Promise.all([
      app.inject({ method: "POST", url: `/tasks/${taskId}/complete`, payload: { userId }, headers }),
      app.inject({ method: "POST", url: `/tasks/${taskId}/complete`, payload: { userId }, headers }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(first.json().taskStatus).toBe("archived");
  });
});
