import type { InjectOptions } from "light-my-request";
import { buildApp } from "../../src/app.js";

// Must match API_KEY in .env.test.
export const TEST_API_KEY = "test-api-key";

type App = ReturnType<typeof buildApp>;

/**
 * Same app as buildApp(), except every inject() call gets the x-api-key
 * header by default (explicit headers on a call still win). Keeps the
 * existing test suites working unchanged after Phase 6 added auth, without
 * touching every one of their inject() call sites individually.
 */
export function buildTestApp(): App {
  const app = buildApp();
  const rawInject = app.inject.bind(app);

  app.inject = ((opts: InjectOptions) => {
    const options = typeof opts === "string" ? { url: opts } : (opts ?? {});
    return rawInject({
      ...options,
      headers: { "x-api-key": TEST_API_KEY, ...options.headers },
    });
  }) as App["inject"];

  return app;
}
