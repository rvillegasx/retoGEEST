import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../db/pool.js";

export interface NotificationAttempt {
  attemptNumber: number;
  attemptedAt: string;
  responseStatus: number | null;
}

interface NotificationAttemptRow extends RowDataPacket {
  attempt_number: number;
  attempted_at: Date;
  response_status: number | null;
}

export async function recordNotificationAttempt(
  taskId: number,
  attemptNumber: number,
  responseStatus: number | null,
): Promise<void> {
  await pool.query(
    "INSERT INTO notification_attempts (task_id, attempt_number, response_status) VALUES (:taskId, :attemptNumber, :responseStatus)",
    { taskId, attemptNumber, responseStatus },
  );
}

export async function getNotificationAttemptsForTask(taskId: number): Promise<NotificationAttempt[]> {
  const [rows] = await pool.query<NotificationAttemptRow[]>(
    `SELECT attempt_number, attempted_at, response_status
     FROM notification_attempts
     WHERE task_id = :taskId
     ORDER BY attempt_number ASC`,
    { taskId },
  );
  return rows.map((row) => ({
    attemptNumber: row.attempt_number,
    attemptedAt: row.attempted_at.toISOString(),
    responseStatus: row.response_status,
  }));
}
