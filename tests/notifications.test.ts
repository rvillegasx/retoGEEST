import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { closeDbPool, resetDatabase } from "./helpers/db.js";

interface CapturedRequest {
  body: { taskId: number; title: string; archivedAt: string };
}

let capturedRequests: CapturedRequest[] = [];
// Returns the HTTP status to respond with, or null to simulate "no response"
// (destroys the connection instead of sending anything back).
let notifyBehavior: (attemptIndex: number) => number | null = () => 200;
let notifyServer: Server;

beforeAll(async () => {
  notifyServer = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      capturedRequests.push({ body: JSON.parse(raw) });
      const status = notifyBehavior(capturedRequests.length);
      if (status === null) {
        req.socket.destroy();
        return;
      }
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ received: true }));
    });
  });
  await new Promise<void>((resolve) => notifyServer.listen(0, "127.0.0.1", () => resolve()));
  const { port } = notifyServer.address() as AddressInfo;
  process.env.NOTIFY_URL = `http://127.0.0.1:${port}/notify`;
});

afterAll(async () => {
  delete process.env.NOTIFY_URL;
  await new Promise<void>((resolve) => notifyServer.close(() => resolve()));
});

describe("Archiving concurrency and notification retries", () => {
  const app = buildApp();

  beforeEach(async () => {
    await resetDatabase();
    capturedRequests = [];
    notifyBehavior = () => 200;
  });

  afterAll(async () => {
    await app.close();
    await closeDbPool();
  });

  async function createUser(email: string): Promise<number> {
    const response = await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "Test", lastName: "User", email },
    });
    return response.json().id as number;
  }

  async function createTask(title = "Task"): Promise<number> {
    const response = await app.inject({ method: "POST", url: "/tasks", payload: { title } });
    return response.json().id as number;
  }

  it("notifies once with the expected payload when a task archives", async () => {
    const userId = await createUser("a@example.com");
    const taskId = await createTask("Quarterly report");
    await app.inject({ method: "POST", url: `/tasks/${taskId}/assign`, payload: { userIds: [userId] } });

    await app.inject({ method: "POST", url: `/tasks/${taskId}/complete`, payload: { userId } });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].body).toMatchObject({ taskId, title: "Quarterly report" });
    expect(typeof capturedRequests[0].body.archivedAt).toBe("string");

    const attemptsResponse = await app.inject({ method: "GET", url: `/tasks/${taskId}/notifications` });
    expect(attemptsResponse.statusCode).toBe(200);
    const attempts = attemptsResponse.json();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ attemptNumber: 1, responseStatus: 200 });
  });

  it("archives exactly once and notifies exactly once when the last two users complete concurrently", async () => {
    const userA = await createUser("a@example.com");
    const userB = await createUser("b@example.com");
    const taskId = await createTask("Shared task");
    await app.inject({
      method: "POST",
      url: `/tasks/${taskId}/assign`,
      payload: { userIds: [userA, userB] },
    });

    const [respA, respB] = await Promise.all([
      app.inject({ method: "POST", url: `/tasks/${taskId}/complete`, payload: { userId: userA } }),
      app.inject({ method: "POST", url: `/tasks/${taskId}/complete`, payload: { userId: userB } }),
    ]);

    expect(respA.statusCode).toBe(200);
    expect(respB.statusCode).toBe(200);
    expect([respA.json().taskStatus, respB.json().taskStatus]).toContain("archived");

    const taskResponse = await app.inject({ method: "GET", url: `/tasks/${taskId}` });
    expect(taskResponse.json().status).toBe("archived");

    expect(capturedRequests).toHaveLength(1);

    const attemptsResponse = await app.inject({ method: "GET", url: `/tasks/${taskId}/notifications` });
    expect(attemptsResponse.json()).toHaveLength(1);
  });

  it("retries on 5xx with growing waits and records every attempt", async () => {
    notifyBehavior = (attemptIndex) => (attemptIndex < 3 ? 503 : 200);

    const userId = await createUser("a@example.com");
    const taskId = await createTask("Task");
    await app.inject({ method: "POST", url: `/tasks/${taskId}/assign`, payload: { userIds: [userId] } });

    const start = Date.now();
    await app.inject({ method: "POST", url: `/tasks/${taskId}/complete`, payload: { userId } });
    const elapsed = Date.now() - start;

    expect(capturedRequests).toHaveLength(3);
    // waits of ~500ms then ~1000ms between the 3 attempts
    expect(elapsed).toBeGreaterThanOrEqual(1400);

    const attemptsResponse = await app.inject({ method: "GET", url: `/tasks/${taskId}/notifications` });
    const attempts = attemptsResponse.json();
    expect(attempts.map((a: { attemptNumber: number }) => a.attemptNumber)).toEqual([1, 2, 3]);
    expect(attempts.map((a: { responseStatus: number }) => a.responseStatus)).toEqual([503, 503, 200]);
  });

  it("stops after 3 attempts total when the destination keeps failing", async () => {
    notifyBehavior = () => 500;

    const userId = await createUser("a@example.com");
    const taskId = await createTask("Task");
    await app.inject({ method: "POST", url: `/tasks/${taskId}/assign`, payload: { userIds: [userId] } });

    await app.inject({ method: "POST", url: `/tasks/${taskId}/complete`, payload: { userId } });

    expect(capturedRequests).toHaveLength(3);
    const attemptsResponse = await app.inject({ method: "GET", url: `/tasks/${taskId}/notifications` });
    expect(attemptsResponse.json()).toHaveLength(3);
  });

  it("retries when the destination doesn't respond and logs a null status", async () => {
    notifyBehavior = (attemptIndex) => (attemptIndex < 2 ? null : 200);

    const userId = await createUser("a@example.com");
    const taskId = await createTask("Task");
    await app.inject({ method: "POST", url: `/tasks/${taskId}/assign`, payload: { userIds: [userId] } });

    await app.inject({ method: "POST", url: `/tasks/${taskId}/complete`, payload: { userId } });

    const attemptsResponse = await app.inject({ method: "GET", url: `/tasks/${taskId}/notifications` });
    const attempts = attemptsResponse.json();
    expect(attempts).toHaveLength(2);
    expect(attempts[0].responseStatus).toBeNull();
    expect(attempts[1].responseStatus).toBe(200);
  });

  it("does not retry on a 4xx response", async () => {
    notifyBehavior = () => 422;

    const userId = await createUser("a@example.com");
    const taskId = await createTask("Task");
    await app.inject({ method: "POST", url: `/tasks/${taskId}/assign`, payload: { userIds: [userId] } });

    await app.inject({ method: "POST", url: `/tasks/${taskId}/complete`, payload: { userId } });

    expect(capturedRequests).toHaveLength(1);
  });

  it("returns TASK_NOT_FOUND for GET /tasks/:idTask/notifications on a nonexistent task", async () => {
    const response = await app.inject({ method: "GET", url: "/tasks/999999/notifications" });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("TASK_NOT_FOUND");
  });

  it("returns an empty list for a task that hasn't archived", async () => {
    const taskId = await createTask("Task");
    const response = await app.inject({ method: "GET", url: `/tasks/${taskId}/notifications` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});
