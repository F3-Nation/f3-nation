import type { ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export async function cleanupAuditStack(
  appGroups: readonly Pick<ChildProcess, "pid">[],
  removeContainer: () => void,
  setupFailure?: { error: unknown; logs: string },
) {
  const errors: unknown[] = [];
  const liveGroups = new Set(
    appGroups.flatMap(({ pid }) => (pid ? [pid] : [])),
  );
  // Attempt every owned process group, even if an earlier signal failed.
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    for (const pid of liveGroups) {
      try {
        process.kill(-pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH")
          liveGroups.delete(pid);
        else errors.push(error);
      }
    }
    if (signal === "SIGTERM") await delay(1000);
  }
  try {
    removeContainer();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) {
    const cleanupError = new AggregateError(
      errors,
      "Audit stack cleanup failed",
    );
    if (setupFailure)
      throw new AggregateError(
        [setupFailure.error, cleanupError],
        `Audit stack setup and cleanup failed; see ${setupFailure.logs}`,
      );
    throw cleanupError;
  }
}
