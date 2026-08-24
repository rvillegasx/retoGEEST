import type { RowDataPacket } from "mysql2/promise";
import { pool } from "../db/pool.js";
import type { TaskStatus } from "./tasksRepository.js";

export interface AssignedUserSummary {
  id: number;
  name: string;
  lastName: string;
  email: string;
  completed: boolean;
}

export interface UserTaskSummary {
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  completed: boolean;
}

interface AssignmentUserRow extends RowDataPacket {
  task_id: number;
  user_id: number;
  name: string;
  last_name: string;
  email: string;
  completed_at: Date | null;
}

interface AssignmentTaskRow extends RowDataPacket {
  user_id: number;
  id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  completed_at: Date | null;
}

export async function assignUsersToTask(taskId: number, userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  const values = userIds.map((userId) => [taskId, userId]);
  await pool.query("INSERT IGNORE INTO task_assignments (task_id, user_id) VALUES ?", [values]);
}

export async function getExistingUserIds(userIds: number[]): Promise<number[]> {
  if (userIds.length === 0) return [];
  const [rows] = await pool.query<RowDataPacket[]>("SELECT id FROM users WHERE id IN (?)", [
    userIds,
  ]);
  return rows.map((row) => row.id as number);
}

export async function getAssignmentStatus(
  taskId: number,
  userId: number,
): Promise<{ completedAt: Date | null } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT completed_at FROM task_assignments WHERE task_id = :taskId AND user_id = :userId",
    { taskId, userId },
  );
  const row = rows[0];
  return row ? { completedAt: row.completed_at as Date | null } : null;
}

export async function markAssignmentCompleted(taskId: number, userId: number): Promise<void> {
  await pool.query(
    "UPDATE task_assignments SET completed_at = NOW() WHERE task_id = :taskId AND user_id = :userId AND completed_at IS NULL",
    { taskId, userId },
  );
}

export async function countIncompleteAssignments(taskId: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS count FROM task_assignments WHERE task_id = :taskId AND completed_at IS NULL",
    { taskId },
  );
  return Number(rows[0]?.count ?? 0);
}

function mapAssignedUserRow(row: AssignmentUserRow): AssignedUserSummary {
  return {
    id: row.user_id,
    name: row.name,
    lastName: row.last_name,
    email: row.email,
    completed: row.completed_at !== null,
  };
}

export async function getAssignedUsersForTask(taskId: number): Promise<AssignedUserSummary[]> {
  const [rows] = await pool.query<AssignmentUserRow[]>(
    `SELECT ta.task_id, u.id AS user_id, u.name, u.last_name, u.email, ta.completed_at
     FROM task_assignments ta
     JOIN users u ON u.id = ta.user_id
     WHERE ta.task_id = :taskId
     ORDER BY u.id ASC`,
    { taskId },
  );
  return rows.map(mapAssignedUserRow);
}

export async function getAssignedUsersForTasks(
  taskIds: number[],
): Promise<Map<number, AssignedUserSummary[]>> {
  const map = new Map<number, AssignedUserSummary[]>();
  if (taskIds.length === 0) return map;

  const [rows] = await pool.query<AssignmentUserRow[]>(
    `SELECT ta.task_id, u.id AS user_id, u.name, u.last_name, u.email, ta.completed_at
     FROM task_assignments ta
     JOIN users u ON u.id = ta.user_id
     WHERE ta.task_id IN (?)
     ORDER BY ta.task_id ASC, u.id ASC`,
    [taskIds],
  );

  for (const row of rows) {
    const list = map.get(row.task_id) ?? [];
    list.push(mapAssignedUserRow(row));
    map.set(row.task_id, list);
  }
  return map;
}

function mapUserTaskRow(row: AssignmentTaskRow): UserTaskSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    completed: row.completed_at !== null,
  };
}

export async function getTasksForUser(userId: number): Promise<UserTaskSummary[]> {
  const [rows] = await pool.query<AssignmentTaskRow[]>(
    `SELECT ta.user_id, t.id, t.title, t.description, t.status, ta.completed_at
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     WHERE ta.user_id = :userId
     ORDER BY t.id ASC`,
    { userId },
  );
  return rows.map(mapUserTaskRow);
}

export async function getPendingTasksForUsers(
  userIds: number[],
): Promise<Map<number, UserTaskSummary[]>> {
  const map = new Map<number, UserTaskSummary[]>();
  if (userIds.length === 0) return map;

  const [rows] = await pool.query<AssignmentTaskRow[]>(
    `SELECT ta.user_id, t.id, t.title, t.description, t.status, ta.completed_at
     FROM task_assignments ta
     JOIN tasks t ON t.id = ta.task_id
     WHERE ta.user_id IN (?) AND ta.completed_at IS NULL
     ORDER BY t.id ASC`,
    [userIds],
  );

  for (const row of rows) {
    const list = map.get(row.user_id) ?? [];
    list.push(mapUserTaskRow(row));
    map.set(row.user_id, list);
  }
  return map;
}
