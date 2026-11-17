import type {
  BetterAuthPlugin,
  GenericEndpointContext,
  HookEndpointContext,
} from "@better-auth/core";
import { isAPIError } from "@better-auth/core/utils/is-api-error";
import { PASSWORD_RESET_PATHS, passwordResetUserId } from "@repo/plugin-utils/password-reset";
import { signInSessionOf } from "@repo/plugin-utils/sign-in";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { EventDetails, Recorder } from "../recorder";
import type { ResolvedAuditLogOptions } from "../types";
import { signInMethod } from "../utils/method";

type Body = Record<string, unknown>;
type Session = NonNullable<GenericEndpointContext["context"]["session"]>;
/** The context hooks get: an endpoint context with `context.returned`. */
type HookContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/** Where the before-hook leaves what it looked up for the after-hook. */
const SUBJECT_KEY = "auditLogSubjectUserId";

/** Endpoints whose failures are failed sign-ins. Only these: they check a credential. */
const SIGN_IN_PATHS = new Set([
  "/sign-in/email",
  "/sign-in/username",
  "/sign-in/phone-number",
  "/sign-in/email-otp",
  "/two-factor/verify-totp",
  "/two-factor/verify-otp",
  "/two-factor/verify-backup-code",
]);

interface PathEvent {
  type: string;
  /**
   * The user the event is about, when it isn't the signed-in user: the
   * admin's target, or a user looked up by the before-hook.
   */
  subject?: ((body: Body, returned: unknown, lookedUp: string | undefined) => unknown) | undefined;
  /** The organization the event is about; defaults to the session's active organization. */
  organization?: ((body: Body, returned: unknown) => unknown) | undefined;
  metadata?: ((body: Body, returned: unknown) => Record<string, unknown>) | undefined;
}

const target = (body: Body) => body.userId;
const lookedUp = (_body: Body, _returned: unknown, userId: string | undefined) => userId;

/** A field of the endpoint's result, if it succeeded (`returned` is an error otherwise). */
function field(returned: unknown, ...path: string[]): unknown {
  let value: unknown = isAPIError(returned) ? undefined : returned;
  for (const key of path) {
    value = value && typeof value === "object" ? (value as Body)[key] : undefined;
  }
  return value;
}

const passwordReset: PathEvent = { type: "password-reset", subject: lookedUp };

/**
 * Organization plugin endpoints. The organization comes from the result,
 * else the body. `addMember` has no path (server-only), so hooks never see
 * it: apps that call it record their own event.
 */
const ORGANIZATION_EVENTS: Record<string, PathEvent> = {
  "/organization/create": {
    type: "organization.created",
    organization: (_body, returned) => field(returned, "id"),
    metadata: (body) => ({ name: body.name ?? null, slug: body.slug ?? null }),
  },
  "/organization/update": {
    type: "organization.updated",
    organization: (body, returned) => field(returned, "id") ?? body.organizationId,
    metadata: (body) => ({
      fields: body.data && typeof body.data === "object" ? Object.keys(body.data) : [],
    }),
  },
  "/organization/delete": {
    type: "organization.deleted",
    organization: (body) => body.organizationId,
  },
  "/organization/invite-member": {
    type: "organization.invitation-created",
    organization: (body, returned) => field(returned, "organizationId") ?? body.organizationId,
    metadata: (body, returned) => ({
      invitationId: field(returned, "id") ?? null,
      email: typeof body.email === "string" ? body.email.toLowerCase() : null,
      role: body.role ?? null,
    }),
  },
  "/organization/accept-invitation": {
    type: "organization.invitation-accepted",
    organization: (_body, returned) => field(returned, "invitation", "organizationId"),
    metadata: (body, returned) => ({
      invitationId: body.invitationId ?? null,
      memberId: field(returned, "member", "id") ?? null,
      role: field(returned, "member", "role") ?? null,
    }),
  },
  "/organization/reject-invitation": {
    type: "organization.invitation-rejected",
    organization: (_body, returned) => field(returned, "invitation", "organizationId"),
    metadata: (body) => ({ invitationId: body.invitationId ?? null }),
  },
  "/organization/cancel-invitation": {
    type: "organization.invitation-canceled",
    organization: (_body, returned) => field(returned, "organizationId"),
    metadata: (body, returned) => ({
      invitationId: body.invitationId ?? null,
      email: field(returned, "email") ?? null,
    }),
  },
  "/organization/remove-member": {
    type: "organization.member-removed",
    subject: (_body, returned) => field(returned, "member", "userId"),
    organization: (body, returned) =>
      field(returned, "member", "organizationId") ?? body.organizationId,
    metadata: (_body, returned) => ({ memberId: field(returned, "member", "id") ?? null }),
  },
  "/organization/update-member-role": {
    type: "organization.member-role-changed",
    subject: (_body, returned) => field(returned, "userId"),
    organization: (body, returned) => field(returned, "organizationId") ?? body.organizationId,
    metadata: (body) => ({ memberId: body.memberId ?? null, role: body.role ?? null }),
  },
  "/organization/leave": {
    type: "organization.member-left",
    organization: (body) => body.organizationId,
  },
};

/** Endpoints recorded by path. Admin actions are recorded on success and on failure. */
const PATH_EVENTS: Record<string, PathEvent> = {
  "/sign-out": { type: "sign-out" },
  "/revoke-session": { type: "session-revoked", metadata: () => ({ scope: "session" }) },
  "/revoke-sessions": { type: "session-revoked", metadata: () => ({ scope: "all" }) },
  "/revoke-other-sessions": { type: "session-revoked", metadata: () => ({ scope: "others" }) },
  "/change-password": {
    type: "password-changed",
    metadata: (body) => ({ revokeOtherSessions: body.revokeOtherSessions === true }),
  },
  "/reset-password": passwordReset,
  "/email-otp/reset-password": passwordReset,
  "/phone-number/reset-password": passwordReset,
  "/unlink-account": {
    type: "account-unlinked",
    metadata: (body) => ({ providerId: body.providerId }),
  },
  "/admin/create-user": {
    type: "admin.create-user",
    subject: (_body, returned) => (returned as { user?: { id?: unknown } } | null)?.user?.id,
    metadata: (body) => ({ role: body.role ?? null }),
  },
  "/admin/update-user": {
    type: "admin.update-user",
    subject: target,
    metadata: (body) => ({
      fields: body.data && typeof body.data === "object" ? Object.keys(body.data) : [],
    }),
  },
  "/admin/set-role": {
    type: "admin.set-role",
    subject: target,
    metadata: (body) => ({ role: body.role }),
  },
  "/admin/set-user-password": { type: "admin.set-user-password", subject: target },
  "/admin/ban-user": {
    type: "admin.ban-user",
    subject: target,
    metadata: (body) => ({ reason: body.banReason ?? null, expiresIn: body.banExpiresIn ?? null }),
  },
  "/admin/unban-user": { type: "admin.unban-user", subject: target },
  "/admin/impersonate-user": { type: "admin.impersonate-user", subject: target },
  // The session is the impersonated one; the actor is the admin behind it.
  "/admin/stop-impersonating": { type: "admin.stop-impersonating" },
  "/admin/revoke-user-session": { type: "admin.revoke-user-session", subject: lookedUp },
  "/admin/revoke-user-sessions": { type: "admin.revoke-user-sessions", subject: target },
  "/admin/remove-user": { type: "admin.remove-user", subject: target },
  ...ORGANIZATION_EVENTS,
};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/**
 * Looks up, before the endpoint runs, what is gone afterwards: the
 * session (sign-out, revoke), the user of a password reset, or of a
 * session an admin revokes.
 */
async function lookUpSubject(ctx: GenericEndpointContext): Promise<string | undefined> {
  const body = (ctx.body ?? {}) as Body;
  if (PASSWORD_RESET_PATHS.has(ctx.path ?? "")) return passwordResetUserId(ctx);
  if (ctx.path === "/admin/revoke-user-session") {
    const token = asString(body.sessionToken);
    if (!token) return undefined;
    return (await ctx.context.internalAdapter.findSession(token))?.user.id;
  }
  return undefined;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]{5,20}$/;

/**
 * Who a failed sign-in was for. People type their password into the
 * email or username field, so the input is only kept when it is clearly
 * an identifier: a well-formed email or phone number, or the username of
 * an existing user.
 */
async function failedSignInSubject(
  ctx: GenericEndpointContext,
  body: Body,
): Promise<{ userId: string | null; identifier: string | null }> {
  const email = asString(body.email)?.trim().toLowerCase();
  if (email) {
    if (!EMAIL.test(email) || email.length > 255) return { userId: null, identifier: null };
    const user = await ctx.context.internalAdapter.findUserByEmail(email);
    return { userId: user?.user.id ?? null, identifier: email };
  }
  const username = asString(body.username)?.trim().toLowerCase();
  if (username) {
    // The username plugin stores usernames lowercased.
    const user = await ctx.context.adapter
      .findOne<{ id: string }>({ model: "user", where: [{ field: "username", value: username }] })
      .catch(() => null);
    return user ? { userId: user.id, identifier: username } : { userId: null, identifier: null };
  }
  const phone = asString(body.phoneNumber)?.trim();
  if (phone && PHONE.test(phone)) {
    const user = await ctx.context.adapter
      .findOne<{ id: string }>({ model: "user", where: [{ field: "phoneNumber", value: phone }] })
      .catch(() => null);
    return { userId: user?.id ?? null, identifier: phone };
  }
  return { userId: null, identifier: null };
}

function failureOf(returned: unknown): { failed: boolean; errorCode: string | null } {
  if (!isAPIError(returned) || returned.statusCode < 400) return { failed: false, errorCode: null };
  const code = (returned.body as { code?: unknown } | undefined)?.code;
  return { failed: true, errorCode: typeof code === "string" ? code : returned.status.toString() };
}

function sessionDetails(session: Session | null | undefined): Partial<EventDetails> {
  if (!session) return {};
  const { id, activeOrganizationId } = session.session as {
    id: string;
    activeOrganizationId?: unknown;
  };
  return { sessionId: id, organizationId: asString(activeOrganizationId) };
}

export function createPathHooks(
  options: ResolvedAuditLogOptions,
  recorder: Recorder,
): NonNullable<BetterAuthPlugin["hooks"]> {
  const eventFor = (path: string | undefined): PathEvent | undefined => {
    if (!path) return undefined;
    if (Object.hasOwn(options.paths, path)) return { type: options.paths[path] as string };
    return Object.hasOwn(PATH_EVENTS, path) ? PATH_EVENTS[path] : undefined;
  };

  return {
    before: [
      {
        matcher: (context: HookEndpointContext) => {
          const event = eventFor(context.path);
          return !!event && recorder.isRecorded(event.type);
        },
        handler: createAuthMiddleware(async (ctx) => {
          try {
            // Loads the session into `ctx.context.session`, where the
            // after-hook finds it even once the endpoint deleted it.
            await getSessionFromCtx(ctx, { disableRefresh: true });
            const subject = await lookUpSubject(ctx);
            if (subject) (ctx.context as unknown as Record<string, unknown>)[SUBJECT_KEY] = subject;
          } catch (error) {
            ctx.context.logger.error("[audit-log] failed to prepare an event", error);
          }
        }),
      },
    ],
    after: [
      {
        matcher: (context: HookEndpointContext) => !!context.path,
        handler: createAuthMiddleware(async (ctx) => {
          try {
            await afterEndpoint(ctx);
          } catch (error) {
            // An after-hook that throws would fail a request that succeeded.
            ctx.context.logger.error("[audit-log] failed to record an event", error);
          }
        }),
      },
    ],
  };

  async function afterEndpoint(ctx: HookContext) {
    const { path } = ctx;
    const body = (ctx.body ?? {}) as Body;
    const headers = ctx.request?.headers ?? ctx.headers ?? null;
    const { failed, errorCode } = failureOf(ctx.context.returned);
    const session = ctx.context.session;

    // A sign-in, by any method: a new session for a request that had none.
    const created = signInSessionOf(ctx);
    if (created) {
      await recorder.record(
        ctx.context,
        {
          type: "sign-in",
          userId: created.user.id,
          actorUserId: created.user.id,
          ...sessionDetails(created),
          metadata: {
            method: signInMethod(path, ctx.params as Body | undefined, body),
          },
        },
        headers,
      );
    }

    if (failed && SIGN_IN_PATHS.has(path)) {
      const { userId, identifier } = await failedSignInSubject(ctx, body);
      await recorder.record(
        ctx.context,
        {
          type: "sign-in",
          status: "failure",
          errorCode,
          userId,
          metadata: {
            method: signInMethod(path),
            ...(identifier ? { identifier } : {}),
          },
        },
        headers,
      );
      return;
    }

    const event = eventFor(path);
    if (!event) return;
    const subject = (ctx.context as unknown as Record<string, unknown>)[SUBJECT_KEY] as
      | string
      | undefined;
    let actorUserId = session?.user.id ?? null;
    let userId = event.subject
      ? asString(event.subject(body, ctx.context.returned, subject))
      : actorUserId;
    if (path === "/admin/stop-impersonating" && session) {
      actorUserId =
        asString((session.session as { impersonatedBy?: unknown }).impersonatedBy) ??
        session.user.id;
      userId = session.user.id;
    }
    // Self-service events of a password reset have no session: the user acts.
    if (PASSWORD_RESET_PATHS.has(path)) actorUserId = userId;
    if (!userId && !actorUserId) return;

    const details = sessionDetails(session);
    const organizationId = event.organization
      ? asString(event.organization(body, ctx.context.returned))
      : null;
    await recorder.record(
      ctx.context,
      {
        type: event.type,
        status: failed ? "failure" : "success",
        errorCode,
        userId,
        actorUserId,
        ...details,
        organizationId: organizationId ?? details.organizationId ?? null,
        metadata: event.metadata ? event.metadata(body, ctx.context.returned) : null,
      },
      headers,
    );
  }
}
