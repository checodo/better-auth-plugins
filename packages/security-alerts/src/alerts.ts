import type { AuthContext, GenericEndpointContext } from "@better-auth/core";
import type { User } from "@better-auth/core/db";
import { getIP } from "@better-auth/core/utils/ip";
import { recordAuditEvent } from "@repo/plugin-utils/audit";
import { runCallback } from "@repo/plugin-utils/callbacks";
import { generateRandomString } from "better-auth/crypto";
import type {
  ResolvedSecurityAlertsOptions,
  SecurityAlert,
  SecurityAlertDetails,
  SecurityAlertType,
} from "./types";
import { describeDevice } from "./utils/device";

export const PLUGIN_ID = "security-alerts";

/** Prefix of the `verification` rows of "This wasn't me" links. */
export const SECURE_ACCOUNT_IDENTIFIER = "security-alerts:secure-account:";
export const SECURE_ACCOUNT_PATH = "/security-alerts/secure-account";

type Context = GenericEndpointContext | null | undefined;

/** What a hook knows about an alert. */
export interface AlertInput {
  type: SecurityAlertType;
  /** The user it is about. */
  userId: string;
  /** The user, if the hook has it already (saves a lookup). */
  user?: (User & Record<string, unknown>) | null | undefined;
  /** Where to send it, if not the user's current email (`email-changed`). */
  email?: string | null | undefined;
  /**
   * Who did it: the signed-in user, by default. Someone else than `userId`
   * means an admin acted on the account.
   */
  actorUserId?: string | null | undefined;
  /** Type-specific details. */
  details?: Partial<SecurityAlertDetails> | undefined;
  /** What the "This wasn't me" link removes again: what the alerted change added. */
  undo?: Undo | undefined;
}

/** Something an attacker may have added, which securing the account removes. */
export interface Undo {
  model: "passkey" | "account" | "apikey";
  id: string;
}

/** What the `verification` row of a "This wasn't me" link holds. */
export interface SecureAccountToken {
  userId: string;
  /** The alert the link was in. */
  alert: SecurityAlertType;
  undo?: Undo | undefined;
  /** `email-changed`: the old address, where the alert went (`emailChange: "restore"`). */
  restoreEmail?: string | undefined;
}

/** Reads the `verification` value of a link; `null` if it isn't one. */
export function parseSecureAccountToken(value: string): SecureAccountToken | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const { userId, alert, undo, restoreEmail } = parsed as Record<string, unknown>;
    if (typeof userId !== "string" || userId === "" || typeof alert !== "string") return null;
    const token: SecureAccountToken = { userId, alert: alert as SecurityAlertType };
    if (
      undo &&
      typeof undo === "object" &&
      ["passkey", "account", "apikey"].includes((undo as Undo).model) &&
      typeof (undo as Undo).id === "string"
    ) {
      token.undo = undo as Undo;
    }
    if (typeof restoreEmail === "string" && restoreEmail !== "") token.restoreEmail = restoreEmail;
    return token;
  } catch {
    return null;
  }
}

/** Headers of the request, or empty ones outside a request. */
export const headersOf = (context: Context): Headers =>
  context?.request?.headers ?? context?.headers ?? new Headers();

/** Creates the single-use "This wasn't me" link for a user. */
async function createSecureAccountUrl(
  authContext: AuthContext,
  data: SecureAccountToken,
  expiresIn: number,
): Promise<string> {
  const token = generateRandomString(32, "a-z", "A-Z", "0-9");
  await authContext.internalAdapter.createVerificationValue({
    identifier: `${SECURE_ACCOUNT_IDENTIFIER}${token}`,
    value: JSON.stringify(data),
    expiresAt: new Date(Date.now() + expiresIn),
  });
  return `${authContext.baseURL}${SECURE_ACCOUNT_PATH}/${token}`;
}

/**
 * Returns the function the hooks call to send an alert: checks that the
 * type is on, builds the details and the "This wasn't me" link, and runs
 * `sendAlert` like other user callbacks (in the background when
 * configured; errors logged), then records `security.alert-sent` in the
 * audit log, if the app has one. Never throws.
 */
export function createAlerter(options: ResolvedSecurityAlertsOptions) {
  return async function alert(
    authContext: AuthContext,
    context: Context,
    input: AlertInput,
  ): Promise<void> {
    try {
      if (!options.alerts[input.type]) return;
      // Securing an account changes it (email, linked accounts): no alerts
      // about that, or restoring an email would alert the address it replaces.
      if (context?.path === SECURE_ACCOUNT_PATH) return;
      const actorUserId =
        input.actorUserId === undefined
          ? (context?.context.session?.user.id ?? null)
          : input.actorUserId;
      // An admin acts on someone else's account, or as them (impersonation).
      const session = input.actorUserId === undefined ? context?.context.session : null;
      const impersonated = !!(session?.session as { impersonatedBy?: unknown } | undefined)
        ?.impersonatedBy;
      const byAdmin = impersonated || (!!actorUserId && actorUserId !== input.userId);
      if (byAdmin && !options.adminActions.alert) return;

      const user =
        input.user ??
        ((await authContext.internalAdapter.findUserById(input.userId)) as
          | (User & Record<string, unknown>)
          | null);
      if (!user) return;
      const email = input.email ?? user.email;
      if (!email) return;

      const headers = headersOf(context);
      const details: SecurityAlertDetails = {
        at: new Date(),
        ipAddress: context ? getIP(context.request ?? headers, authContext.options) : null,
        userAgent: headers.get("user-agent"),
        device: describeDevice(options.newDevice.getDevice(headers)),
        actor: options.adminActions.showActor ? (byAdmin ? "admin" : "user") : null,
        ...input.details,
      };
      const secureAccountUrl =
        options.secureAccount && input.type !== "password-reset-requested"
          ? await createSecureAccountUrl(
              authContext,
              {
                userId: user.id,
                alert: input.type,
                ...(input.undo ? { undo: input.undo } : {}),
                ...(input.type === "email-changed" ? { restoreEmail: email } : {}),
              },
              options.secureAccount.expiresIn,
            )
          : null;

      const payload: SecurityAlert = { type: input.type, user, email, details, secureAccountUrl };
      const audit = (status: "success" | "failure") =>
        recordAuditEvent({
          type: "security.alert-sent",
          status,
          severity: "low",
          userId: user.id,
          actorUserId,
          metadata: { alert: input.type },
        });
      await runCallback(
        authContext,
        PLUGIN_ID,
        "sendAlert",
        () => options.sendAlert(payload, context?.request),
        () => audit("success"),
        () => audit("failure"),
      );
    } catch (error) {
      authContext.logger.error(`[${PLUGIN_ID}] failed to send a ${input.type} alert`, error);
    }
  };
}

export type Alerter = ReturnType<typeof createAlerter>;
