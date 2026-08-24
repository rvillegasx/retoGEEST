import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

const name = process.argv[2];
if (!name) {
  console.error("Usage: npm run migrate:create <migration_name>");
  process.exit(1);
}

const existing = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
const nextNumber = String(existing.length + 1).padStart(4, "0");
const filename = `${nextNumber}_${name}.sql`;
const filepath = path.join(migrationsDir, filename);

writeFileSync(filepath, `-- Migration: ${name}\n`);
console.log(`Created ${filepath}`);
