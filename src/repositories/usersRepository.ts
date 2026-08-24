import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { pool } from "../db/pool.js";

export interface User {
  id: number;
  name: string;
  lastName: string;
  email: string;
}

export interface CreateUserInput {
  name: string;
  lastName: string;
  email: string;
}

interface UserRow extends RowDataPacket {
  id: number;
  name: string;
  last_name: string;
  email: string;
}

function mapRow(row: UserRow): User {
  return { id: row.id, name: row.name, lastName: row.last_name, email: row.email };
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const [result] = await pool.query<ResultSetHeader>(
    "INSERT INTO users (name, last_name, email) VALUES (:name, :lastName, :email)",
    { ...input },
  );
  return { id: result.insertId, ...input };
}

export async function getUserById(id: number): Promise<User | null> {
  const [rows] = await pool.query<UserRow[]>("SELECT * FROM users WHERE id = :id", { id });
  const row = rows[0];
  return row ? mapRow(row) : null;
}

export async function listUsers(): Promise<User[]> {
  const [rows] = await pool.query<UserRow[]>("SELECT * FROM users ORDER BY id ASC");
  return rows.map(mapRow);
}
