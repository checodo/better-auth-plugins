import type { BetterAuthClientPlugin } from "better-auth/client";
import type { EmailNormalizationPlugin } from "./email";
import { NORMALIZE_ERROR_CODES } from "./error-codes";

/**
 * Client companion to `emailNormalization()` and `phoneNormalization()`:
 * adds their error codes (`INVALID_PHONE_NUMBER`), so `error.code` can be
 * compared with `NORMALIZE_ERROR_CODES`. Neither adds client endpoints.
 *
 * @example
 * ```ts
 * import { createAuthClient } from "better-auth/client";
 * import { normalizeClient } from "@checodo/better-auth-normalize/client";
 *
 * export const authClient = createAuthClient({
 *   plugins: [normalizeClient()],
 * });
 * ```
 */
export const normalizeClient = () => {
  return {
    id: "normalize",
    $InferServerPlugin: {} as EmailNormalizationPlugin,
    $ERROR_CODES: NORMALIZE_ERROR_CODES,
  } satisfies BetterAuthClientPlugin;
};

export { NORMALIZE_ERROR_CODES } from "./error-codes";
