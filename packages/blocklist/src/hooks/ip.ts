import type { AuthContext, BetterAuthOptions, HookEndpointContext } from "@better-auth/core";
import { getIP } from "@better-auth/core/utils/ip";
import { createAuthMiddleware } from "better-auth/api";
import { assertIpAllowed } from "../check";
import type { BlocklistIpScope, ResolvedBlocklistOptions } from "../types";

/** The parts of an endpoint context the IP check reads. */
interface RequestContext {
  path?: string | undefined;
  request?: Request | undefined;
  headers?: Headers | undefined;
  context: Pick<AuthContext, "adapter" | "logger" | "options">;
}

/**
 * The app's options with full IPv6 addresses. better-auth collapses IPv6
 * addresses to their /64 network by default (`advanced.ipAddress.ipv6Subnet`),
 * which suits rate limiting but would make an exact IPv6 rule never match.
 * Everything else (headers, trusted proxies, `disableIpTracking`) is the
 * app's own setting.
 */
function withFullIpv6(options: BetterAuthOptions): BetterAuthOptions {
  return {
    ...options,
    advanced: {
      ...options.advanced,
      ipAddress: { ...options.advanced?.ipAddress, ipv6Subnet: 128 },
    },
  };
}

/** Endpoints run by an admin for someone else, where the admin's IP doesn't count. */
const isAdminPath = (path: string | undefined) => !!path?.startsWith("/admin/");

/**
 * The request's country from `getCountry`, or `null` without one. An
 * error thrown by `getCountry` is logged and counts as an unknown country,
 * like a request without the country header: the IP rules still apply.
 */
async function readCountry(
  ctx: RequestContext,
  options: ResolvedBlocklistOptions,
  headers: Headers,
): Promise<string | null | undefined> {
  if (!options.ip.getCountry) return null;
  try {
    return await options.ip.getCountry({ request: ctx.request, headers });
  } catch (error) {
    ctx.context.logger.error("[blocklist] getCountry threw an error", error);
    return null;
  }
}

/**
 * Throws if the request's IP address or country is blocked for `scope`.
 * Does nothing without a request (server code calling the adapter
 * directly), outside the configured scopes, and on admin endpoints.
 */
export async function checkClientIp(
  ctx: RequestContext | null | undefined,
  options: ResolvedBlocklistOptions,
  scope: BlocklistIpScope,
): Promise<void> {
  if (!ctx || !options.ip.scope.has(scope) || isAdminPath(ctx.path)) return;
  const headers = ctx.request?.headers ?? ctx.headers;
  if (!headers) return;

  const ip = getIP(ctx.request ?? headers, withFullIpv6(ctx.context.options));
  const country = await readCountry(ctx, options, headers);
  await assertIpAllowed(ctx.context.adapter, options, { ip, country }, ctx.context.logger);
}

/**
 * Checks `/sign-up/*` and `/sign-in/*` before the handler runs, so a
 * blocked client learns nothing else, not even whether a password was
 * right. The database hooks (`./database.ts`) check again when a user or
 * session is created, which covers OAuth callbacks, magic links, and
 * every other way in.
 */
export function createIpHook(options: ResolvedBlocklistOptions) {
  const scopeOf = (path: string | undefined): BlocklistIpScope | null =>
    path?.startsWith("/sign-up/") ? "sign-up" : path?.startsWith("/sign-in/") ? "sign-in" : null;

  return {
    matcher: (context: HookEndpointContext) => {
      const scope = scopeOf(context.path);
      return scope !== null && options.ip.scope.has(scope);
    },
    handler: createAuthMiddleware(async (ctx) => {
      const scope = scopeOf(ctx.path);
      if (scope) await checkClientIp(ctx, options, scope);
    }),
  };
}
