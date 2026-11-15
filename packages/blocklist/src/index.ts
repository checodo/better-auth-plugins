import type { BetterAuthPlugin } from "@better-auth/core";
import { mergeSchema } from "better-auth/db";
import { version } from "../package.json";
import { BLOCKLIST_ERROR_CODES } from "./error-codes";
import { createBeforeHook } from "./hooks/before";
import { createDatabaseHooks } from "./hooks/database";
import { resolveOptions } from "./options";
import { createRuleEndpoints } from "./routes/rules";
import { blocklistSchema } from "./schema";
import type { BlocklistOptions } from "./types";

export { BLOCKLIST_ERROR_CODES, type BlocklistErrorCode } from "./error-codes";
export type {
  BlocklistEmailOptions,
  BlocklistMatchType,
  BlocklistOptions,
  BlocklistRule,
  BlocklistRuleInput,
  BlocklistTarget,
  BlocklistTargetOptions,
  StoredBlocklistRule,
} from "./types";

/**
 * Blocks disallowed emails, usernames, and organization and team names
 * when they are created or changed.
 *
 * @example
 * ```ts
 * import { betterAuth } from "better-auth";
 * import { blocklist } from "@checodo/better-auth-blocklist";
 *
 * export const auth = betterAuth({
 *   plugins: [
 *     blocklist({
 *       email: { domains: ["mailinator.com"] },
 *       username: { values: ["admin", "root"] },
 *     }),
 *   ],
 * });
 * ```
 */
export const blocklist = (options: BlocklistOptions = {}) => {
  const resolved = resolveOptions(options);

  return {
    id: "blocklist",
    version,
    init(ctx) {
      return { options: { databaseHooks: createDatabaseHooks(ctx, resolved) } };
    },
    // mergeSchema changes the object it gets, so each instance gets a copy.
    schema: mergeSchema(structuredClone(blocklistSchema), options.schema),
    endpoints: createRuleEndpoints(resolved),
    hooks: {
      before: [createBeforeHook(resolved)],
    },
    $ERROR_CODES: BLOCKLIST_ERROR_CODES,
    options,
  } satisfies BetterAuthPlugin;
};

export type BlocklistPlugin = ReturnType<typeof blocklist>;

/** Lets `auth.$context.getPlugin("blocklist")` infer this plugin's exact type. */
declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    blocklist: {
      creator: typeof blocklist;
    };
  }
}
