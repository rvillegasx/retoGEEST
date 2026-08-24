import { getNotifyUrl } from "../config/env.js";
import { recordNotificationAttempt } from "../repositories/notificationAttemptsRepository.js";
import type { Task } from "../repositories/tasksRepository.js";

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POSTs the archive event to NOTIFY_URL, retrying with growing waits on a
 * 5xx response or no response at all, up to MAX_ATTEMPTS. Every attempt is
 * logged regardless of outcome. Runs synchronously (awaited by the caller)
 * so a client polling GET /tasks/:idTask/notifications right after the
 * completing request sees the full attempt history deterministically.
 */
export async function notifyTaskArchived(task: Task): Promise<void> {
  const notifyUrl = getNotifyUrl();
  if (!notifyUrl) return;

  const payload = { taskId: task.id, title: task.title, archivedAt: task.archivedAt };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let responseStatus: number | null = null;
    let shouldRetry = false;

    try {
      const response = await fetch(notifyUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      responseStatus = response.status;
      shouldRetry = response.status >= 500;
    } catch {
      shouldRetry = true;
    }

    await recordNotificationAttempt(task.id, attempt, responseStatus);

    if (!shouldRetry) return;
    if (attempt < MAX_ATTEMPTS) {
      await sleep(BASE_DELAY_MS * attempt);
    }
  }
}
