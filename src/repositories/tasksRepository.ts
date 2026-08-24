import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../db/pool.js";

export type TaskStatus = "open" | "archived";

export interface Task {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  archivedAt: string | null;
}

export interface CreateTaskInput {
  title: string;
  description: string | null;
}

interface TaskRow extends RowDataPacket {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  archived_at: Date | null;
}

function mapRow(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    archivedAt: row.archived_at ? row.archived_at.toISOString() : null,
  };
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO tasks (title, description) VALUES (:title, :description)",
    { ...input },
  );
  return {
    id: result.insertId,
    title: input.title,
    description: input.description,
    status: "open",
    archivedAt: null,
  };
}

export async function getTaskById(id: number): Promise<Task | null> {
  const [rows] = await pool.query<TaskRow[]>("SELECT * FROM tasks WHERE id = :id", { id });
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Archives the task iff it's still open. Returns whether THIS call performed
 * the transition (affectedRows === 1) so callers only fire the archive
 * notification once, even if two "last completion" requests race here.
 */
export async function archiveTask(id: number): Promise<boolean> {
  const [result] = await pool.query<ResultSetHeader>(
    "UPDATE tasks SET status = 'archived', archived_at = NOW() WHERE id = :id AND status = 'open'",
    { id },
  );
  return result.affectedRows === 1;
}

export async function listTasks(status?: TaskStatus): Promise<Task[]> {
  const [rows] = status
    ? await pool.query<TaskRow[]>(
        "SELECT * FROM tasks WHERE status = :status ORDER BY id ASC",
        { status },
      )
    : await pool.query<TaskRow[]>("SELECT * FROM tasks ORDER BY id ASC");
  return rows.map(mapRow);
}
