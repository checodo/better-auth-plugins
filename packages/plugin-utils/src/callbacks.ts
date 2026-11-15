import type { AuthContext } from "@better-auth/core";

/**
 * Runs a user callback (`onJoin`, `onReferralCompleted`, ...) in the
 * background when better-auth's `advanced.backgroundTasks` is configured,
 * so response times don't depend on it, and awaits it otherwise. Errors
 * are logged as `[<pluginId>] <name> threw an error` and never reach the
 * client.
 */
export async function runCallback(
  context: Pick<AuthContext, "logger" | "runInBackgroundOrAwait">,
  pluginId: string,
  name: string,
  callback: () => void | Promise<void>,
): Promise<void> {
  const task = (async () => {
    try {
      await callback();
    } catch (error) {
      context.logger.error(`[${pluginId}] ${name} threw an error`, error);
    }
  })();
  await context.runInBackgroundOrAwait(task);
}
