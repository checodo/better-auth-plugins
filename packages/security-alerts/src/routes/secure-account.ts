import type { GenericEndpointContext } from "@better-auth/core";
import type { User } from "@better-auth/core/db";
import { recordAuditEvent } from "@repo/plugin-utils/audit";
import { runCallback } from "@repo/plugin-utils/callbacks";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { deleteSessionCookie } from "better-auth/cookies";
import { generateRandomString } from "better-auth/crypto";
import * as z from "zod";
import type { Undo } from "../alerts";
import {
  PLUGIN_ID,
  parseSecureAccountToken,
  SECURE_ACCOUNT_IDENTIFIER,
  SECURE_ACCOUNT_PATH,
} from "../alerts";
import { expireDevices } from "../devices";
import { SECURITY_ALERTS_ERROR_CODES } from "../error-codes";
import type { ResolvedSecurityAlertsOptions, SecurityAlertsPasswordAction } from "../types";

const tokenSchema = z
  .string()
  .min(1)
  .max(64)
  .meta({ description: 'The token from the "This wasn\'t me" link' });

/** `url` with query parameters added, relative URLs resolved against the app. */
function withQuery(baseURL: string, url: string, query: Record<string, string>): string {
  const result = new URL(url, baseURL);
  for (const [key, value] of Object.entries(query)) result.searchParams.set(key, value);
  return result.href;
}

/**
 * What happens to the password, for this user and app: nothing for users
 * without a password, and nothing without `sendResetPassword` (a blocked
 * password could not be reset).
 */
async function applyPasswordAction(
  ctx: GenericEndpointContext,
  userId: string,
  action: SecurityAlertsPasswordAction,
  resetPasswordURL: string | undefined,
): Promise<SecurityAlertsPasswordAction> {
  const sendResetPassword = ctx.context.options.emailAndPassword?.sendResetPassword;
  if (action === "none" || !sendResetPassword) return "none";
  const credential = await ctx.context.internalAdapter.findCredentialAccount(userId);
  if (!credential?.password) return "none";
  const user = await ctx.context.internalAdapter.findUserById(userId);
  if (!user) return "none";

  if (action === "block") {
    // A random password nobody knows: the old one stops working.
    const unusable = await ctx.context.password.hash(generateRandomString(64, "a-z", "A-Z", "0-9"));
    await ctx.context.internalAdapter.updatePassword(userId, unusable);
  }

  // The same link as `requestPasswordReset` sends.
  const token = generateRandomString(24, "a-z", "A-Z", "0-9");
  const expiresIn = ctx.context.options.emailAndPassword?.resetPasswordTokenExpiresIn || 3600;
  await ctx.context.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: userId,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  });
  const callbackURL = encodeURIComponent(resetPasswordURL ?? "");
  const url = `${ctx.context.baseURL}/reset-password/${token}?callbackURL=${callbackURL}`;
  await ctx.context.runInBackgroundOrAwait(sendResetPassword({ user, url, token }, ctx.request));
  return action;
}

/**
 * Puts the old email address back (`emailChange: "restore"`), marked
 * verified: the person who confirms opened a link sent to it. Not when
 * another account has the address by now. Returns the restored address,
 * or `null`.
 */
async function restoreEmail(
  ctx: GenericEndpointContext,
  userId: string,
  email: string,
): Promise<string | null> {
  const { internalAdapter, logger } = ctx.context;
  const owner = await internalAdapter.findUserByEmail(email);
  if (owner?.user.id === userId) return null;
  if (owner) {
    logger.warn(
      `[security-alerts] user ${userId}'s old email belongs to another account by now: not restored`,
    );
    return null;
  }
  await internalAdapter.updateUser(userId, { email, emailVerified: true });
  return email;
}

/**
 * Removes what the alerted change added (a passkey, a linked account, an
 * API key), so whoever added it can't sign in with it again. Only the
 * user's own; `null` if there was nothing (left) to remove.
 */
async function undoChange(
  ctx: GenericEndpointContext,
  userId: string,
  undo: Undo,
): Promise<Undo["model"] | null> {
  try {
    const { adapter, internalAdapter } = ctx.context;
    if (undo.model === "account") {
      const account = await adapter.findOne<{ userId: string; providerId: string }>({
        model: "account",
        where: [{ field: "id", value: undo.id }],
      });
      if (account?.userId !== userId || account.providerId === "credential") return null;
      await internalAdapter.deleteAccount(undo.id);
      return "account";
    }
    // Passkeys belong to the user; API keys to the user or an organization,
    // and the user created this one.
    const where = [{ field: "id", value: undo.id }];
    if (undo.model === "passkey") where.push({ field: "userId", value: userId });
    const row = await adapter.findOne({ model: undo.model, where });
    if (!row) return null;
    await adapter.delete({ model: undo.model, where });
    return undo.model;
  } catch (error) {
    // E.g. the passkey or api-key plugin was removed since.
    ctx.context.logger.error(`[security-alerts] failed to remove the ${undo.model}`, error);
    return null;
  }
}

export function createSecureAccountEndpoints(options: ResolvedSecurityAlertsOptions) {
  return {
    secureAccountCallback: createAuthEndpoint(
      `${SECURE_ACCOUNT_PATH}/:token`,
      {
        method: "GET",
        metadata: {
          // A link in an email, not something the client calls.
          isAction: false,
          openapi: {
            description:
              "The \"This wasn't me\" link in alerts. Changes nothing: redirects to the app's confirmation page (`secureAccount.callbackURL`) with `?token=...`, or `?error=INVALID_TOKEN`",
          },
        },
      },
      async (ctx) => {
        const config = options.secureAccount;
        if (!config) {
          throw APIError.from("BAD_REQUEST", SECURITY_ALERTS_ERROR_CODES.INVALID_TOKEN);
        }
        const token = ctx.params.token;
        const verification = token
          ? await ctx.context.internalAdapter.findVerificationValue(
              `${SECURE_ACCOUNT_IDENTIFIER}${token}`,
            )
          : null;
        const valid = !!verification && new Date(verification.expiresAt) > new Date();
        throw ctx.redirect(
          withQuery(
            ctx.context.baseURL,
            config.callbackURL,
            valid && token ? { token } : { error: "INVALID_TOKEN" },
          ),
        );
      },
    ),

    secureAccount: createAuthEndpoint(
      SECURE_ACCOUNT_PATH,
      {
        method: "POST",
        body: z.object({ token: tokenSchema }),
        metadata: {
          openapi: {
            description:
              'Secure the account after a "This wasn\'t me": signs out every session, makes every device new again, removes the passkey, linked account, or API key the alert was about, restores the old email (`emailChange: "restore"`), and blocks the password or sends a reset link (`secureAccount.password`). The token works once',
          },
        },
      },
      async (ctx) => {
        const config = options.secureAccount;
        if (!config) {
          throw APIError.from("BAD_REQUEST", SECURITY_ALERTS_ERROR_CODES.INVALID_TOKEN);
        }
        const { internalAdapter } = ctx.context;
        // Deletes the token and returns it, once: concurrent requests can't both use it.
        const verification = await internalAdapter.consumeVerificationValue(
          `${SECURE_ACCOUNT_IDENTIFIER}${ctx.body.token}`,
        );
        if (!verification || new Date(verification.expiresAt) <= new Date()) {
          throw APIError.from("BAD_REQUEST", SECURITY_ALERTS_ERROR_CODES.INVALID_TOKEN);
        }
        const data = parseSecureAccountToken(verification.value);
        const user = data ? await internalAdapter.findUserById(data.userId) : null;
        if (!data || !user) {
          throw APIError.from("BAD_REQUEST", SECURITY_ALERTS_ERROR_CODES.INVALID_TOKEN);
        }
        const { userId } = data;

        await internalAdapter.deleteUserSessions(userId);
        // Every device is new again: the next sign-ins alert (kept, not
        // deleted, so the next one isn't taken for the first sign-in).
        await expireDevices(ctx.context.adapter, userId);
        // Before the reset link, which goes to the account's email.
        const restoredEmail =
          config.emailChange === "restore" && data.alert === "email-changed" && data.restoreEmail
            ? await restoreEmail(ctx, userId, data.restoreEmail)
            : null;
        const password = await applyPasswordAction(
          ctx,
          userId,
          config.password,
          config.resetPasswordURL,
        );
        const removed = data.undo ? await undoChange(ctx, userId, data.undo) : null;
        // Whoever confirms may be signed in as this user in this browser.
        deleteSessionCookie(ctx);

        await recordAuditEvent({
          type: "security.account-secured",
          severity: "high",
          userId,
          actorUserId: userId,
          // Not "password": the audit log redacts keys like that.
          metadata: { alert: data.alert, credentialAction: password, removed, restoredEmail },
        });
        const { onSecured } = config;
        if (onSecured) {
          const secured = ((await internalAdapter.findUserById(userId)) ?? user) as User &
            Record<string, unknown>;
          await runCallback(ctx.context, PLUGIN_ID, "onSecured", () =>
            onSecured(
              { user: secured, alert: data.alert, password, removed, restoredEmail },
              ctx.request,
            ),
          );
        }
        return ctx.json({ status: true });
      },
    ),
  };
}
