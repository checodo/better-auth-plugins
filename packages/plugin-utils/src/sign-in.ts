import type { GenericEndpointContext } from "@better-auth/core";
import { isAPIError } from "@better-auth/core/utils/is-api-error";

/**
 * Endpoints that set a new session cookie for a user who is already signed
 * in (rotation, impersonation): not sign-ins. Most of them also load the
 * session, which rules them out anyway; this list covers the rest.
 */
export const NOT_SIGN_IN_PATHS: ReadonlySet<string> = new Set([
  "/change-password",
  "/update-user",
  "/update-session",
  "/change-email",
  "/two-factor/enable",
  "/two-factor/disable",
  "/admin/impersonate-user",
  "/admin/stop-impersonating",
  "/multi-session/set-active",
]);

type NewSession = NonNullable<GenericEndpointContext["context"]["newSession"]>;

/**
 * The session an after-hook's endpoint signed the user in with, by any
 * method (password, OAuth callback, magic link, passkey, OTP, ...): a new
 * session for a request that had none, from an endpoint that succeeded,
 * that isn't a session rotation or an impersonation. `null` otherwise.
 *
 * `ctx.context.session` is only set when something loaded the session
 * before the endpoint ran (the endpoint itself, or a before-hook).
 */
export function signInSessionOf(ctx: GenericEndpointContext): NewSession | null {
  const returned = (ctx.context as { returned?: unknown }).returned;
  // Redirects (OAuth callbacks, magic links) are thrown as API errors too.
  if (isAPIError(returned) && returned.statusCode >= 400) return null;
  const created = ctx.context.newSession;
  if (!created || ctx.context.session) return null;
  if (ctx.path && NOT_SIGN_IN_PATHS.has(ctx.path)) return null;
  if ((created.session as { impersonatedBy?: unknown }).impersonatedBy) return null;
  return created;
}
