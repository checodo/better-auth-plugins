import type { BetterAuthPlugin, HookEndpointContext } from "@better-auth/core";
import type { User } from "@better-auth/core/db";
import { isAPIError } from "@better-auth/core/utils/is-api-error";
import {
  PASSWORD_RESET_PATHS,
  PASSWORD_RESET_REQUEST_PATHS,
  passwordResetRequestUserId,
  passwordResetUserId,
} from "@repo/plugin-utils/password-reset";
import { signInSessionOf } from "@repo/plugin-utils/sign-in";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { Alerter } from "../alerts";
import { PLUGIN_ID } from "../alerts";
import { handleSignIn } from "../devices";
import type { ResolvedSecurityAlertsOptions } from "../types";

type Body = Record<string, unknown>;

/** Where the before-hook leaves what it looked up for the after-hook. */
const LOOKED_UP_KEY = "securityAlertsLookedUp";

interface LookedUp {
  /** The user of a password reset, or the owner of a passkey being deleted. */
  userId?: string | undefined;
  passkeyName?: string | null | undefined;
}

/** Endpoints handled here, besides sign-ins (any endpoint that creates a session). */
const PATHS = new Set([
  "/change-password",
  "/admin/set-user-password",
  "/passkey/verify-registration",
  "/passkey/delete-passkey",
  "/api-key/create",
  ...PASSWORD_RESET_PATHS,
  ...PASSWORD_RESET_REQUEST_PATHS,
]);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** A field of the endpoint's result, if it succeeded (`returned` is an error otherwise). */
function field(returned: unknown, key: string): unknown {
  if (isAPIError(returned) || !returned || typeof returned !== "object") return undefined;
  return (returned as Body)[key];
}

const channelOf = (path: string) =>
  path.startsWith("/phone-number/") ? ("phone-number" as const) : ("email" as const);

export function createPathHooks(
  options: ResolvedSecurityAlertsOptions,
  alert: Alerter,
): NonNullable<BetterAuthPlugin["hooks"]> {
  return {
    before: [
      {
        matcher: (context: HookEndpointContext) => !!context.path && PATHS.has(context.path),
        handler: createAuthMiddleware(async (ctx) => {
          try {
            // Loads the session into `ctx.context.session`, where the
            // after-hook finds it even once the endpoint changed it.
            await getSessionFromCtx(ctx, { disableRefresh: true });
            const lookedUp: LookedUp = {};
            if (PASSWORD_RESET_PATHS.has(ctx.path)) {
              lookedUp.userId = await passwordResetUserId(ctx);
            }
            if (ctx.path === "/passkey/delete-passkey") {
              const id = asString((ctx.body as Body | undefined)?.id);
              const passkey = id
                ? await ctx.context.adapter.findOne<{ userId: string; name?: string | null }>({
                    model: "passkey",
                    where: [{ field: "id", value: id }],
                  })
                : null;
              lookedUp.userId = passkey?.userId;
              lookedUp.passkeyName = passkey?.name ?? null;
            }
            (ctx.context as unknown as Record<string, unknown>)[LOOKED_UP_KEY] = lookedUp;
          } catch (error) {
            ctx.context.logger.error(`[${PLUGIN_ID}] failed to prepare an alert`, error);
          }
        }),
      },
    ],
    after: [
      {
        matcher: (context: HookEndpointContext) => !!context.path,
        handler: createAuthMiddleware(async (ctx) => {
          try {
            const signIn = signInSessionOf(ctx);
            if (signIn && options.alerts["new-device"]) {
              await handleSignIn(ctx.context, ctx, options, alert, {
                user: signIn.user as User & Record<string, unknown>,
                session: signIn.session,
              });
            }
            if (PATHS.has(ctx.path)) await afterEndpoint(ctx);
          } catch (error) {
            // An after-hook that throws would fail a request that succeeded.
            ctx.context.logger.error(`[${PLUGIN_ID}] failed to send an alert`, error);
          }
        }),
      },
    ],
  };

  async function afterEndpoint(ctx: Parameters<Parameters<typeof createAuthMiddleware>[0]>[0]) {
    const { path } = ctx;
    const returned = ctx.context.returned;
    if (isAPIError(returned) && returned.statusCode >= 400) return;
    const body = (ctx.body ?? {}) as Body;
    const session = ctx.context.session;
    const lookedUp = ((ctx.context as unknown as Record<string, unknown>)[LOOKED_UP_KEY] ??
      {}) as LookedUp;

    if (path === "/change-password") {
      if (!session) return;
      await alert(ctx.context, ctx, { type: "password-changed", userId: session.user.id });
      return;
    }
    if (path === "/admin/set-user-password") {
      const userId = asString(body.userId);
      if (userId) await alert(ctx.context, ctx, { type: "password-changed", userId });
      return;
    }
    if (PASSWORD_RESET_PATHS.has(path)) {
      if (!lookedUp.userId) return;
      await alert(ctx.context, ctx, {
        type: "password-reset",
        userId: lookedUp.userId,
        actorUserId: lookedUp.userId,
        details: { channel: channelOf(path) },
      });
      return;
    }
    if (PASSWORD_RESET_REQUEST_PATHS.has(path)) {
      // Answered the same for unknown emails; the alert goes to the owner only.
      const userId = await passwordResetRequestUserId(ctx);
      if (!userId) return;
      await alert(ctx.context, ctx, {
        type: "password-reset-requested",
        userId,
        actorUserId: null,
        details: { channel: channelOf(path) },
      });
      return;
    }
    if (path === "/passkey/verify-registration") {
      const userId = asString(field(returned, "userId"));
      const passkeyId = asString(field(returned, "id"));
      if (!userId) return;
      await alert(ctx.context, ctx, {
        type: "passkey-added",
        userId,
        actorUserId: userId,
        details: {
          passkeyId: passkeyId ?? undefined,
          passkeyName: asString(field(returned, "name")),
        },
        undo: passkeyId ? { model: "passkey", id: passkeyId } : undefined,
      });
      return;
    }
    if (path === "/passkey/delete-passkey") {
      if (!lookedUp.userId) return;
      await alert(ctx.context, ctx, {
        type: "passkey-removed",
        userId: lookedUp.userId,
        details: { passkeyId: asString(body.id) ?? undefined, passkeyName: lookedUp.passkeyName },
      });
      return;
    }
    if (path === "/api-key/create") {
      // Organization keys belong to the organization: the alert goes to
      // whoever created it.
      const userId =
        session?.user.id ?? asString(body.userId) ?? asString(field(returned, "userId"));
      if (!userId) return;
      const apiKeyId = asString(field(returned, "id"));
      await alert(ctx.context, ctx, {
        type: "api-key-created",
        userId,
        actorUserId: userId,
        details: { apiKeyId: apiKeyId ?? undefined, apiKeyName: asString(field(returned, "name")) },
        undo: apiKeyId ? { model: "apikey", id: apiKeyId } : undefined,
      });
    }
  }
}
