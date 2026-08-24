import { pool } from "../../src/db/pool.js";

const TABLES = ["idempotency_keys", "notification_attempts", "task_assignments", "tasks", "users"];

export async function resetDatabase(): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const table of TABLES) {
      await connection.query(`TRUNCATE TABLE ${table}`);
    }
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  } finally {
    connection.release();
  }
}

export async function closeDbPool(): Promise<void> {
  await pool.end();
}
