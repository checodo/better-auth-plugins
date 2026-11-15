import type { BetterAuthClientPlugin } from "better-auth/client";
import { BLOCKLIST_ERROR_CODES } from "./error-codes";
import type { BlocklistPlugin } from "./index";

/**
 * Client companion to `blocklist()`. Adds `authClient.blocklist.listRules`,
 * `createRule`, and `deleteRule`, typed from the server plugin.
 *
 * @example
 * ```ts
 * import { createAuthClient } from "better-auth/client";
 * import { blocklistClient } from "@checodo/better-auth-blocklist/client";
 *
 * export const authClient = createAuthClient({
 *   plugins: [blocklistClient()],
 * });
 * ```
 */
export const blocklistClient = () => {
  return {
    id: "blocklist",
    $InferServerPlugin: {} as BlocklistPlugin,
    pathMethods: {
      "/blocklist/list-rules": "GET",
      "/blocklist/create-rule": "POST",
      "/blocklist/delete-rule": "POST",
    },
    $ERROR_CODES: BLOCKLIST_ERROR_CODES,
  } satisfies BetterAuthClientPlugin;
};

export { BLOCKLIST_ERROR_CODES } from "./error-codes";
