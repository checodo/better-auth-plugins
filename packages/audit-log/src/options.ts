import { resolveAdminOptions } from "@repo/plugin-utils/admin";
import { createFail } from "@repo/plugin-utils/options";
import type {
  AuditEventSeverity,
  AuditLogDestinationEntry,
  AuditLogOptions,
  ResolvedAuditLogOptions,
  ResolvedDestination,
} from "./types";

/** Longest event type. */
export const MAX_TYPE_LENGTH = 64;
const SEVERITIES: readonly AuditEventSeverity[] = ["low", "medium", "high", "critical"];

const fail: (message: string) => never = createFail("audit-log");

export function isValidEventType(type: string): boolean {
  return type.length <= MAX_TYPE_LENGTH && /^[a-z0-9][a-z0-9._-]*$/i.test(type);
}

/**
 * Compiles `events` patterns into a matcher: exact types, or `group.*`
 * for every type starting with `group.`.
 */
export function compileEventFilter(
  patterns: readonly string[],
  option = "events",
): (type: string) => boolean {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith(".*") && isValidEventType(pattern.slice(0, -2))) {
      prefixes.push(pattern.slice(0, -1));
    } else if (isValidEventType(pattern)) {
      exact.add(pattern);
    } else {
      fail(`Invalid event pattern ${JSON.stringify(pattern)} in "${option}".`);
    }
  }
  return (type) => exact.has(type) || prefixes.some((prefix) => type.startsWith(prefix));
}

const MAX_BATCH_SIZE = 1000;
const MAX_BATCH_WAIT = 60_000;
const DEFAULT_TIMEOUT = 10_000;
const MAX_TIMEOUT = 300_000;

const isIntegerIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function resolveDestinations(
  destinations: readonly AuditLogDestinationEntry[] | undefined,
): ResolvedDestination[] {
  if (destinations === undefined) return [];
  if (!Array.isArray(destinations)) fail('"destinations" must be an array.');
  const names = new Set<string>();
  return destinations.map((destination, index) => {
    const name = destination?.name;
    if (typeof name !== "string" || name.trim() === "") {
      fail(`"destinations[${index}].name" must be a non-empty string.`);
    }
    if (names.has(name)) fail(`Two destinations are named ${JSON.stringify(name)}.`);
    names.add(name);
    const option = `destinations "${name}"`;
    if (typeof destination.send !== "function") fail(`"send" of ${option} must be a function.`);
    if (destination.transform !== undefined && typeof destination.transform !== "function") {
      fail(`"transform" of ${option} must be a function.`);
    }
    const size = destination.batch?.size ?? 1;
    if (!isIntegerIn(size, 1, MAX_BATCH_SIZE)) {
      fail(`"batch.size" of ${option} must be a whole number from 1 to ${MAX_BATCH_SIZE}.`);
    }
    const wait = destination.batch?.wait ?? (size === 1 ? 0 : 1000);
    if (!isIntegerIn(wait, 0, MAX_BATCH_WAIT)) {
      fail(`"batch.wait" of ${option} must be 0 to ${MAX_BATCH_WAIT} milliseconds.`);
    }
    const timeout = destination.timeout ?? DEFAULT_TIMEOUT;
    if (!isIntegerIn(timeout, 1, MAX_TIMEOUT)) {
      fail(`"timeout" of ${option} must be 1 to ${MAX_TIMEOUT} milliseconds.`);
    }
    return {
      name,
      events: destination.events
        ? compileEventFilter(destination.events, `${option}.events`)
        : null,
      transform: destination.transform,
      send: destination.send as ResolvedDestination["send"],
      size,
      wait,
      timeout,
    };
  });
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
    if (options.storage && typeof options.storage.deleteOlderThan !== "function") {
      fail('"retention" needs a storage that can delete events ("deleteOlderThan").');
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
    destinations: resolveDestinations(options.destinations),
    retention,
    hashChain,
    ...resolveAdminOptions(options),
  };
}
