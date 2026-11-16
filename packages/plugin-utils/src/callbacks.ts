import type { AuthContext } from "@better-auth/core";

/**
 * Runs a user callback (`onJoin`, `onReferralCompleted`, ...) in the
 * background when better-auth's `advanced.backgroundTasks` is configured,
 * so response times don't depend on it, and awaits it otherwise. Errors
 * are logged as `[<pluginId>] <name> threw an error` and never reach the
 * client.
 *
 * `onSuccess` runs after the callback returned without an error (in the
 * same task, so also in the background), e.g. to record that a reward was
 * delivered. Its errors are logged too.
 */
export async function runCallback(
  context: Pick<AuthContext, "logger" | "runInBackgroundOrAwait">,
  pluginId: string,
  name: string,
  callback: () => void | Promise<void>,
  onSuccess?: () => void | Promise<void>,
): Promise<void> {
  const task = (async () => {
    try {
      await callback();
    } catch (error) {
      context.logger.error(`[${pluginId}] ${name} threw an error`, error);
      return;
    }
    if (!onSuccess) return;
    try {
      await onSuccess();
    } catch (error) {
      context.logger.error(`[${pluginId}] failed to record that ${name} succeeded`, error);
    }
  })();
  await context.runInBackgroundOrAwait(task);
}
