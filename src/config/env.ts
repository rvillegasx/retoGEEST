import { config } from "dotenv";

config({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  db: {
    host: required("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 3306),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    database: required("DB_NAME"),
  },
};

// Read live (not cached at import time) so it can be pointed at a fake
// destination in tests without needing to reimport the whole app module graph.
export function getNotifyUrl(): string | null {
  return process.env.NOTIFY_URL || null;
}
