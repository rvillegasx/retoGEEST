import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../db/pool.js";

export type IdempotencyStatus = "in_progress" | "completed";

export interface IdempotencyRecord {
  requestHash: string;
  status: IdempotencyStatus;
  responseStatus: number | null;
  responseBody: unknown;
  createdAt: Date;
}

interface IdempotencyRow extends RowDataPacket {
  request_hash: string;
  status: IdempotencyStatus;
  response_status: number | null;
  response_body: string | null;
  created_at: Date;
}

function mapRow(row: IdempotencyRow): IdempotencyRecord {
  return {
    requestHash: row.request_hash,
    status: row.status,
    responseStatus: row.response_status,
    responseBody: row.response_body ? JSON.parse(row.response_body) : null,
    createdAt: row.created_at,
  };
}

function isDuplicateEntryError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ER_DUP_ENTRY";
}

/** Atomically claims the key for this (method, path). Returns false if another request already owns it. */
export async function tryClaim(
  key: string,
  method: string,
  path: string,
  requestHash: string,
): Promise<boolean> {
  try {
    await pool.query(
      `INSERT INTO idempotency_keys (idempotency_key, method, path, request_hash, status)
       VALUES (:key, :method, :path, :requestHash, 'in_progress')`,
      { key, method, path, requestHash },
    );
    return true;
  } catch (err) {
    if (isDuplicateEntryError(err)) return false;
    throw err;
  }
}

export async function getRecord(
  key: string,
  method: string,
  path: string,
): Promise<IdempotencyRecord | null> {
  const [rows] = await pool.query<IdempotencyRow[]>(
    "SELECT * FROM idempotency_keys WHERE idempotency_key = :key AND method = :method AND path = :path",
    { key, method, path },
  );
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function completeRecord(
  key: string,
  method: string,
  path: string,
  responseStatus: number,
  responseBody: unknown,
): Promise<void> {
  await pool.query(
    `UPDATE idempotency_keys
     SET status = 'completed', response_status = :responseStatus, response_body = :responseBody, completed_at = NOW()
     WHERE idempotency_key = :key AND method = :method AND path = :path`,
    { key, method, path, responseStatus, responseBody: JSON.stringify(responseBody) },
  );
}

export async function deleteRecord(key: string, method: string, path: string): Promise<void> {
  await pool.query(
    "DELETE FROM idempotency_keys WHERE idempotency_key = :key AND method = :method AND path = :path",
    { key, method, path },
  );
}
