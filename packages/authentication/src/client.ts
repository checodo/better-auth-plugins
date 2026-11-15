import type { BetterAuthClientPlugin } from "better-auth/client";
import { AUTHENTICATION_ERROR_CODES } from "./error-codes";
import type { AuthenticationPlugin } from "./index";

/**
 * Client companion to `authentication()`. The providers need no client
 * methods of their own: sign in with better-auth's `signIn.social` and link
 * with `linkSocial`. This adds the plugin's error codes to the client.
 *
 * @example
 * ```ts
 * import { createAuthClient } from "better-auth/client";
 * import { authenticationClient } from "@checodo/better-auth-authentication/client";
 *
 * export const authClient = createAuthClient({ plugins: [authenticationClient()] });
 *
 * await authClient.signIn.social({ provider: "epic", callbackURL: "/dashboard" });
 * ```
 */
export const authenticationClient = () => {
  return {
    id: "authentication",
    $InferServerPlugin: {} as AuthenticationPlugin,
    $ERROR_CODES: AUTHENTICATION_ERROR_CODES,
  } satisfies BetterAuthClientPlugin;
};

export { AUTHENTICATION_CALLBACK_ERRORS, AUTHENTICATION_ERROR_CODES } from "./error-codes";
