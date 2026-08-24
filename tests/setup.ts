import { config } from "dotenv";

// Loaded first (see vitest.config.ts setupFiles) so DB_NAME etc. point at the
// dedicated test database before any module does `import "dotenv/config"`
// against .env — dotenv never overrides vars already set in process.env.
config({ path: ".env.test", quiet: true });
