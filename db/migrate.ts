import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mysql, { type RowDataPacket } from "mysql2/promise";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

interface MigrationRow {
  name: string;
}

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const [rows] = await connection.query<RowDataPacket[]>(
    "SELECT name FROM schema_migrations",
  );
  const applied = new Set((rows as MigrationRow[]).map((r) => r.name));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let appliedCount = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(path.join(migrationsDir, file), "utf-8");
    console.log(`Applying migration: ${file}`);
    await connection.query(sql);
    await connection.query("INSERT INTO schema_migrations (name) VALUES (?)", [file]);
    appliedCount += 1;
  }

  console.log(
    appliedCount === 0
      ? "No pending migrations."
      : `Applied ${appliedCount} migration(s).`,
  );
  await connection.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
