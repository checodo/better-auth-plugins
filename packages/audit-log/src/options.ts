import { resolveAdminOptions } from "@repo/plugin-utils/admin";
import { createFail } from "@repo/plugin-utils/options";
import type { AuditEventSeverity, AuditLogOptions, ResolvedAuditLogOptions } from "./types";

/** Longest event type. */
export const MAX_TYPE_LENGTH = 64;
const SEVERITIES: readonly AuditEventSeverity[] = ["low", "medium", "high", "critical"];

const fail = createFail("audit-log");

export function isValidEventType(type: string): boolean {
  return type.length <= MAX_TYPE_LENGTH && /^[a-z0-9][a-z0-9._-]*$/i.test(type);
}

/**
 * Compiles `events` patterns into a matcher: exact types, or `group.*`
 * for every type starting with `group.`.
 */
export function compileEventFilter(patterns: readonly string[]): (type: string) => boolean {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith(".*") && isValidEventType(pattern.slice(0, -2))) {
      prefixes.push(pattern.slice(0, -1));
    } else if (isValidEventType(pattern)) {
      exact.add(pattern);
    } else {
      fail(`Invalid event pattern ${JSON.stringify(pattern)} in "events".`);
    }
  }
  return (type) => exact.has(type) || prefixes.some((prefix) => type.startsWith(prefix));
}

/** Resolves defaults and validates the options once, at plugin creation. */
export function resolveOptions(options: AuditLogOptions): ResolvedAuditLogOptions {
  const paths = { ...options.paths };
  for (const [path, type] of Object.entries(paths)) {
    if (!path.startsWith("/")) fail(`Path ${JSON.stringify(path)} in "paths" must start with "/".`);
    if (!isValidEventType(type)) {
      fail(
        `Invalid event type ${JSON.stringify(type)} in "paths": use letters, digits, ".", "-", and "_", up to ${MAX_TYPE_LENGTH} characters.`,
      );
    }
  }

  const severity = { ...options.severity };
  for (const [type, value] of Object.entries(severity)) {
    if (!SEVERITIES.includes(value)) {
      fail(
        `Invalid severity ${JSON.stringify(value)} for "${type}": use ${SEVERITIES.join(", ")}.`,
      );
    }
  }

  let retention: ResolvedAuditLogOptions["retention"];
  if (options.retention) {
    const { days, sweepInterval = 3600 } = options.retention;
    if (!(typeof days === "number" && days > 0 && Number.isFinite(days))) {
      fail(`"retention.days" must be a positive number, got ${days}.`);
    }
    if (!(typeof sweepInterval === "number" && sweepInterval > 0)) {
      fail(`"retention.sweepInterval" must be a positive number of seconds, got ${sweepInterval}.`);
    }
    retention = { days, sweepInterval };
  }

  let hashChain: ResolvedAuditLogOptions["hashChain"] = null;
  if (options.hashChain) {
    if (options.storage) {
      fail('"hashChain" needs the default database storage; remove "storage" or "hashChain".');
    }
    const secret = typeof options.hashChain === "object" ? options.hashChain.secret : undefined;
    if (secret !== undefined && secret.length < 32) {
      fail('"hashChain.secret" must be at least 32 characters.');
    }
    hashChain = { secret };
  }

  return {
    events: options.events ? compileEventFilter(options.events) : null,
    paths,
    severity,
    captureIp: options.captureIp ?? true,
    captureUserAgent: options.captureUserAgent ?? true,
    beforeLog: options.beforeLog,
    onEvent: options.onEvent,
    storage: options.storage,
    retention,
    hashChain,
    ...resolveAdminOptions(options),
  };
}
