import { ValidationError } from "./errors.js";

export function parsePositiveIntParam(value: string, paramName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${paramName} must be a positive integer`, "INVALID_PARAM");
  }
  return parsed;
}
