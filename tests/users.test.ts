import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers/app.js";
import { closeDbPool, resetDatabase } from "./helpers/db.js";

describe("Users", () => {
  const app = buildTestApp();

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await closeDbPool();
  });

  it("creates a user via POST /users", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ name: "Ada", lastName: "Lovelace", email: "ada@example.com" });
    expect(typeof body.id).toBe("number");
  });

  it("returns MISSING_FIELD when a required field is missing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "Ada", email: "ada@example.com" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "MISSING_FIELD", message: expect.any(String) },
    });
  });

  it("returns INVALID_EMAIL for a malformed email", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "Ada", lastName: "Lovelace", email: "not-an-email" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_EMAIL");
  });

  it("returns EMAIL_ALREADY_REGISTERED for a duplicate email", async () => {
    await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    });

    const response = await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "Grace", lastName: "Hopper", email: "ada@example.com" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("EMAIL_ALREADY_REGISTERED");
  });

  it("lists created users with pendingTasks via GET /users", async () => {
    await app.inject({
      method: "POST",
      url: "/users",
      payload: { name: "Ada", lastName: "Lovelace", email: "ada@example.com" },
    });

    const response = await app.inject({ method: "GET", url: "/users" });

    expect(response.statusCode).toBe(200);
    const users = response.json();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      name: "Ada",
      lastName: "Lovelace",
      email: "ada@example.com",
      pendingTasks: [],
    });
  });
});
