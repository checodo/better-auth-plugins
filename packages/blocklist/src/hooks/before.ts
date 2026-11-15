import type { HookEndpointContext } from "@better-auth/core";
import { createAuthMiddleware } from "better-auth/api";
import { assertNotBlocked } from "../check";
import type { BlocklistTarget, ResolvedBlocklistOptions } from "../types";

type Body = Record<string, unknown>;

/**
 * Endpoints whose input is checked before the handler runs, and how to
 * read the values from the request body. Emails and usernames on sign-up
 * and profile updates are checked by the database hooks instead (see
 * `./database.ts`), which also cover OAuth, magic link, and OTP sign-ups.
 * `/change-email` and the email OTP plugin's `/email-otp/request-email-change`
 * are checked here as well, so a blocked address fails before a
 * verification email or code is sent to it.
 *
 * The availability checks (`/is-username-available`,
 * `/organization/check-slug`) answer a blocked value with the same error
 * as the real request, so forms can show it while the user types. They
 * don't trigger `onBlocked`: nothing is created, and they run per keystroke.
 *
 * The waitlist plugin's `/waitlist/join` and `/waitlist/create-invite`,
 * and the organization plugin's `/organization/invite-member`, are checked
 * too, so a blocked email can't join the waitlist or be invited, only to
 * fail at sign-up (and no invitation email goes to it).
 *
 * With teams enabled, the organization plugin creates a default team named
 * after a new organization, so `/organization/create` also checks the name
 * against the team rules (see `createsDefaultTeam`).
 */
type Check = [Exclude<BlocklistTarget, "password" | "ip">, (body: Body) => unknown];

const CHECKS: Record<string, { checks: Check[]; notify: boolean }> = {
  "/change-email": { checks: [["email", (body) => body.newEmail]], notify: true },
  "/email-otp/request-email-change": {
    checks: [["email", (body) => body.newEmail]],
    notify: true,
  },
  "/organization/create": {
    checks: [
      ["organization", (body) => body.name],
      ["organization", (body) => body.slug],
    ],
    notify: true,
  },
  "/organization/update": {
    checks: [
      ["organization", (body) => data(body).name],
      ["organization", (body) => data(body).slug],
    ],
    notify: true,
  },
  "/organization/invite-member": { checks: [["email", (body) => body.email]], notify: true },
  "/organization/create-team": { checks: [["team", (body) => body.name]], notify: true },
  "/organization/update-team": { checks: [["team", (body) => data(body).name]], notify: true },
  "/waitlist/join": { checks: [["email", (body) => body.email]], notify: true },
  "/waitlist/create-invite": { checks: [["email", (body) => body.email]], notify: true },
  "/is-username-available": { checks: [["username", (body) => body.username]], notify: false },
  "/organization/check-slug": { checks: [["organization", (body) => body.slug]], notify: false },
};

/** Whether the organization plugin creates a default team for new organizations. */
function createsDefaultTeam(plugins: readonly { id: string; options?: unknown }[] | undefined) {
  const options = plugins?.find((plugin) => plugin.id === "organization")?.options as
    | { teams?: { enabled?: boolean; defaultTeam?: { enabled?: boolean } } }
    | undefined;
  return options?.teams?.enabled === true && options.teams.defaultTeam?.enabled !== false;
}

function data(body: Body): Body {
  return typeof body.data === "object" && body.data !== null ? (body.data as Body) : {};
}

export function createBeforeHook(options: ResolvedBlocklistOptions) {
  return {
    matcher: (context: HookEndpointContext) =>
      !!context.path && Object.hasOwn(CHECKS, context.path),
    handler: createAuthMiddleware(async (ctx) => {
      const entry = CHECKS[ctx.path];
      const body = ctx.body as Body | undefined;
      if (!entry || typeof body !== "object" || body === null) return;

      const checks =
        ctx.path === "/organization/create" && createsDefaultTeam(ctx.context.options.plugins)
          ? [...entry.checks, ["team", (b: Body) => b.name] satisfies Check]
          : entry.checks;

      for (const [target, read] of checks) {
        await assertNotBlocked(ctx.context.adapter, options, target, read(body), {
          notify: entry.notify,
          logger: ctx.context.logger,
        });
      }
    }),
  };
}
