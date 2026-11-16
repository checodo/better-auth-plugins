import type { AuthContext } from "@better-auth/core";
import { getCurrentAdapter, tryGetCurrentAuthEndpointContext } from "@better-auth/core/context";
import { assertPasswordAllowed } from "../check";
import type { ResolvedBlocklistOptions } from "../types";
import type { ContextSource } from "../utils/password";
import { emailLocalPart } from "../utils/password";

/**
 * Endpoints that set a new password: the official `haveIBeenPwned`
 * plugin's defaults, plus `/set-password`. The password is checked when
 * the endpoint hashes it, so after better-auth has checked its length and
 * verified the reset token or OTP: nobody can probe the rules without one.
 */
export const PASSWORD_PATHS = new Set([
  "/sign-up/email",
  "/change-password",
  "/set-password",
  "/reset-password",
  "/email-otp/reset-password",
  "/phone-number/reset-password",
  "/admin/create-user",
  "/admin/set-user-password",
]);

/**
 * Server-only endpoints have no path of their own (better-auth runs them
 * as `virtual:`), so they are recognized by their operation id, the name
 * they have on `auth.api`.
 */
const SERVER_ONLY_PASSWORD_ENDPOINTS: Readonly<Record<string, string>> = {
  setPassword: "/set-password",
};

type Endpoint = NonNullable<ReturnType<typeof tryGetCurrentAuthEndpointContext>>;

/** The `PASSWORD_PATHS` entry of the running endpoint, or `null` if it doesn't set a password. */
function passwordPath(endpoint: Endpoint | null | undefined): string | null {
  if (!endpoint) return null;
  if (endpoint.path && PASSWORD_PATHS.has(endpoint.path)) return endpoint.path;
  const { operationId } = endpoint as { operationId?: unknown };
  if (
    typeof operationId !== "string" ||
    !Object.hasOwn(SERVER_ONLY_PASSWORD_ENDPOINTS, operationId)
  ) {
    return null;
  }
  return SERVER_ONLY_PASSWORD_ENDPOINTS[operationId] ?? null;
}
type Body = Record<string, unknown>;
type UserLike = { email?: unknown; username?: unknown } | null | undefined;

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

/** Finds the user whose password an endpoint sets, for the context words. */
async function findUser(endpoint: Endpoint, path: string, body: Body): Promise<UserLike> {
  const auth = endpoint.context;
  const session = (auth as { session?: { user?: UserLike } | null }).session;
  switch (path) {
    case "/change-password":
    case "/set-password":
      return session?.user;
    case "/admin/set-user-password":
      return typeof body.userId === "string"
        ? auth.internalAdapter.findUserById(body.userId)
        : null;
    case "/reset-password": {
      // Not consumed yet: the endpoint hashes the password first.
      const token = text(body.token) ?? text((endpoint.query as Body | undefined)?.token);
      if (!token) return null;
      const verification = await auth.internalAdapter.findVerificationValue(
        `reset-password:${token}`,
      );
      return verification ? auth.internalAdapter.findUserById(verification.value) : null;
    }
    case "/email-otp/reset-password":
      return typeof body.email === "string"
        ? (await auth.internalAdapter.findUserByEmail(body.email.toLowerCase()))?.user
        : null;
    case "/phone-number/reset-password": {
      if (typeof body.phoneNumber !== "string") return null;
      const db = await getCurrentAdapter(auth.adapter);
      return db.findOne<{ email: string; username?: string }>({
        model: "user",
        where: [{ field: "phoneNumber", value: body.phoneNumber }],
      });
    }
    default:
      // "/sign-up/email" and "/admin/create-user": the user doesn't exist yet.
      return { email: body.email, username: body.username ?? data(body).username };
  }
}

function data(body: Body): Body {
  return typeof body.data === "object" && body.data !== null ? (body.data as Body) : {};
}

/**
 * Wraps better-auth's password hasher so new passwords are checked on
 * `PASSWORD_PATHS` (and nowhere else, so verifying a password on sign-in
 * never is). Returned from the plugin's `init` as `context.password`;
 * plugins that wrap it too, such as `haveIBeenPwned`, are wrapped in turn.
 */
export function wrapPasswordHasher(
  authContext: AuthContext,
  options: ResolvedBlocklistOptions,
): AuthContext["password"] {
  const original = authContext.password;
  return {
    ...original,
    async hash(password) {
      const endpoint = tryGetCurrentAuthEndpointContext();
      const path = passwordPath(endpoint);
      if (endpoint && path) {
        const body = (endpoint.body ?? {}) as Body;
        const user = options.password.checkContext ? await findUser(endpoint, path, body) : null;
        const context: Partial<Record<ContextSource, string | undefined>> = {
          email: emailLocalPart(user?.email),
          username: text(user?.username),
          // Only an app name the app set: the default, "Better Auth", would block "better".
          appName: endpoint.context.options.appName,
        };
        await assertPasswordAllowed(
          endpoint.context.adapter,
          options,
          password,
          context,
          endpoint.context.logger,
        );
      }
      return original.hash(password);
    },
  };
}
