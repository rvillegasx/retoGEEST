import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { TEST_API_KEY } from "./helpers/app.js";
import { closeDbPool, resetDatabase } from "./helpers/db.js";

describe("API key authentication", () => {
  const app = buildApp();

  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects requests without an x-api-key header", async () => {
    const response = await app.inject({ method: "GET", url: "/users" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: expect.any(String) },
    });
  });

  it("rejects requests with a wrong x-api-key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/users",
      headers: { "x-api-key": "not-the-right-key" },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHORIZED");
  });

  it("allows requests with the correct x-api-key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/users",
      headers: { "x-api-key": TEST_API_KEY },
    });

    expect(response.statusCode).toBe(200);
  });

  it("applies to POST endpoints too", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "Task" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("does not require a key for GET /health", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
  });
});

describe("Rate limiting", () => {
  afterEach(() => {
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.RATE_LIMIT_WINDOW;
  });

  afterAll(async () => {
    await closeDbPool();
  });

  it("returns 429 with the standard error shape once the limit is exceeded", async () => {
    process.env.RATE_LIMIT_MAX = "3";
    process.env.RATE_LIMIT_WINDOW = "1 minute";
    const limitedApp = buildApp();

    try {
      const responses = [];
      for (let i = 0; i < 4; i++) {
        responses.push(
          await limitedApp.inject({
            method: "GET",
            url: "/users",
            headers: { "x-api-key": TEST_API_KEY },
          }),
        );
      }

      const statusCodes = responses.map((r) => r.statusCode);
      expect(statusCodes.slice(0, 3)).toEqual([200, 200, 200]);
      expect(statusCodes[3]).toBe(429);
      expect(responses[3].json()).toEqual({
        error: { code: "RATE_LIMIT_EXCEEDED", message: expect.any(String) },
      });
    } finally {
      await limitedApp.close();
    }
  });

  it("does not rate-limit under the generous default used elsewhere", async () => {
    const defaultApp = buildApp();

    try {
      const responses = await Promise.all(
        Array.from({ length: 10 }, () =>
          defaultApp.inject({ method: "GET", url: "/users", headers: { "x-api-key": TEST_API_KEY } }),
        ),
      );

      expect(responses.every((r) => r.statusCode === 200)).toBe(true);
    } finally {
      await defaultApp.close();
    }
  });
});
