import type { AuthContext } from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";
import { recordAuditEvent } from "@repo/plugin-utils/audit";
import { APIError } from "better-auth/api";
import type { BlocklistErrorCode } from "./error-codes";
import { BLOCKLIST_ERROR_CODES } from "./error-codes";
import { listStoredRules } from "./store";
import type {
  BlocklistRule,
  BlocklistTarget,
  CompiledRule,
  ResolvedBlocklistOptions,
} from "./types";
import type { NormalizeSettings } from "./utils/matchers";
import { compileRule, normalizeCountry, normalizeTargetValue } from "./utils/matchers";
import { normalizeValue } from "./utils/normalize";
import type { ContextSource } from "./utils/password";
import { contextWords, foldLeetspeak } from "./utils/password";
import { RuleSet } from "./utils/rule-set";

const ERROR_CODE_BY_TARGET: Record<BlocklistTarget, BlocklistErrorCode> = {
  email: "EMAIL_NOT_ALLOWED",
  username: "USERNAME_NOT_ALLOWED",
  organization: "ORGANIZATION_NAME_NOT_ALLOWED",
  team: "TEAM_NAME_NOT_ALLOWED",
  password: "PASSWORD_NOT_ALLOWED",
  ip: "IP_ADDRESS_NOT_ALLOWED",
};

/** What `onBlocked` and the audit log get instead of a password. */
export const REDACTED = "[redacted]";

type Adapter = AuthContext["adapter"];
type Logger = Pick<AuthContext["logger"], "error">;

export function normalizeSettings(options: ResolvedBlocklistOptions): NormalizeSettings {
  return { full: options.normalize, stripPlusAddressing: options.stripPlusAddressing };
}

/** Reads and compiles the database rules of `target`. */
async function loadDatabaseRules(
  adapter: Adapter,
  target: BlocklistTarget,
  settings: NormalizeSettings,
): Promise<RuleSet> {
  // Read through the current transaction, if any, so checks inside
  // database hooks don't wait on the transaction that writes the user.
  const db = await getCurrentAdapter(adapter);
  const rules = new RuleSet();
  for (const row of await listStoredRules(db, target)) {
    const compiled = compileRule(
      target,
      { id: row.id, type: row.type, value: row.value, reason: row.reason ?? undefined },
      settings,
    );
    if (compiled) rules.add(compiled);
  }
  return rules;
}

/**
 * Runs `match` against the static rules of `target`, then, when none of
 * them match and the target uses database rules, against the database
 * rules (cached, see `databaseCacheTtl`).
 */
async function matchRules(
  adapter: Adapter,
  options: ResolvedBlocklistOptions,
  target: BlocklistTarget,
  match: (rules: RuleSet) => CompiledRule | null,
): Promise<CompiledRule | null> {
  const targetOptions = options.targets[target];
  const staticMatch = match(targetOptions.rules);
  if (staticMatch) return staticMatch;
  if (!targetOptions.useDatabase) return null;

  const settings = normalizeSettings(options);
  const stored = await options.databaseRules.get(target, () =>
    loadDatabaseRules(adapter, target, settings),
  );
  return match(stored);
}

/** Returns the first rule of `target` that blocks `rawValue`, or `null`. */
export async function findBlockingRule(
  adapter: Adapter,
  options: ResolvedBlocklistOptions,
  target: BlocklistTarget,
  rawValue: string,
): Promise<CompiledRule | null> {
  const value = normalizeTargetValue(target, rawValue, normalizeSettings(options));
  if (options.targets[target].allow.match(value)) return null;
  const folded = target === "password" ? foldLeetspeak(value) : value;
  return matchRules(adapter, options, target, (rules) => rules.match(value, folded));
}

/**
 * What `onBlocked` and the audit log may see of a blocked value. Passwords
 * are never passed on: their `value` is `REDACTED`, and so is the value of
 * the password rule that matched, since an `exact` rule is the password
 * and a `contains` rule part of it. `contextRule` marks the rules of the
 * context check, whose value names the source (`[email]`), not a password.
 */
function redact(details: {
  target: BlocklistTarget;
  value: string;
  rule: BlocklistRule;
  contextRule?: boolean;
}): { target: BlocklistTarget; value: string; rule: BlocklistRule } {
  if (details.target !== "password") {
    return { target: details.target, value: details.value, rule: details.rule };
  }
  const rule = details.contextRule ? details.rule : { ...details.rule, value: REDACTED };
  return { target: details.target, value: REDACTED, rule };
}

/**
 * Calls `onBlocked` and records a `blocklist.blocked` audit event, with
 * passwords redacted (see `redact`). Errors from `onBlocked` are logged,
 * never returned to the client.
 */
async function reportBlocked(
  options: ResolvedBlocklistOptions,
  details: { target: BlocklistTarget; value: string; rule: BlocklistRule; contextRule?: boolean },
  errorCode: BlocklistErrorCode,
  logger: Logger | undefined,
): Promise<void> {
  const safe = redact(details);
  if (options.onBlocked) {
    try {
      await options.onBlocked(safe);
    } catch (error) {
      (logger ?? console).error("[blocklist] onBlocked threw an error", error);
    }
  }
  await recordAuditEvent({
    type: "blocklist.blocked",
    status: "failure",
    severity: "medium",
    errorCode,
    metadata: {
      target: safe.target,
      value: safe.value.slice(0, 255),
      rule: { type: safe.rule.type, value: safe.rule.value },
    },
  });
}

/** The error code of a blocked text value: the target's own, or `VALUE_NOT_ALLOWED`. */
function textErrorCode(
  options: ResolvedBlocklistOptions,
  code: BlocklistErrorCode,
): BlocklistErrorCode {
  return options.genericErrorMessage ? "VALUE_NOT_ALLOWED" : code;
}

/**
 * Throws a 400 `APIError` if `rawValue` is blocked for `target`. Does
 * nothing for empty values. `notify: false` skips `onBlocked`, for checks
 * that don't create or change anything (availability checks).
 */
export async function assertNotBlocked(
  adapter: Adapter,
  options: ResolvedBlocklistOptions,
  target: Exclude<BlocklistTarget, "ip">,
  rawValue: unknown,
  { notify = true, logger }: { notify?: boolean; logger?: Logger | undefined } = {},
): Promise<void> {
  if (typeof rawValue !== "string" || rawValue.trim() === "") return;

  const match = await findBlockingRule(adapter, options, target, rawValue);
  if (!match) return;

  const code = textErrorCode(options, ERROR_CODE_BY_TARGET[target]);
  if (notify)
    await reportBlocked(options, { target, value: rawValue, rule: match.rule }, code, logger);
  throw APIError.from("BAD_REQUEST", BLOCKLIST_ERROR_CODES[code]);
}

/**
 * Throws a 400 `APIError` if a new password is blocked by a `password`
 * rule, or, with `checkContext`, contains one of the context words: the
 * email's local part, the username, or the app name.
 */
export async function assertPasswordAllowed(
  adapter: Adapter,
  options: ResolvedBlocklistOptions,
  password: string,
  context: Partial<Record<ContextSource, string | null | undefined>>,
  logger: Logger | undefined,
): Promise<void> {
  await assertNotBlocked(adapter, options, "password", password, { logger });
  if (!options.password.checkContext) return;

  const folded = foldLeetspeak(normalizeValue(password, options.normalize));
  const words = contextWords(context, (value) => normalizeValue(value, options.normalize));
  const found = words.find(({ word }) => folded.includes(word));
  if (!found) return;

  const code = textErrorCode(options, "PASSWORD_CONTAINS_CONTEXT_WORD");
  await reportBlocked(
    options,
    {
      target: "password",
      value: password,
      rule: { type: "contains", value: `[${found.source}]`, reason: "Context-specific word" },
      contextRule: true,
    },
    code,
    logger,
  );
  throw APIError.from("BAD_REQUEST", BLOCKLIST_ERROR_CODES[code]);
}

/**
 * Throws a 403 `APIError` if the client IP address or its country is
 * blocked. An allowed IP address skips the country rules too. Does
 * nothing when neither is known.
 */
export async function assertIpAllowed(
  adapter: Adapter,
  options: ResolvedBlocklistOptions,
  client: { ip: string | null; country: string | null | undefined },
  logger: Logger | undefined,
): Promise<void> {
  let match: CompiledRule | null = null;
  let value = "";

  if (client.ip) {
    const ip = normalizeTargetValue("ip", client.ip, normalizeSettings(options));
    if (options.targets.ip.allow.match(ip)) return;
    match = await matchRules(adapter, options, "ip", (rules) => rules.match(ip));
    value = ip;
  }
  const country = client.country ? normalizeCountry(client.country) : null;
  if (!match && country) {
    match = await matchRules(adapter, options, "ip", (rules) => rules.matchCountry(country));
    value = country.toUpperCase();
  }
  if (!match) return;

  await reportBlocked(
    options,
    { target: "ip", value, rule: match.rule },
    "IP_ADDRESS_NOT_ALLOWED",
    logger,
  );
  throw APIError.from("FORBIDDEN", BLOCKLIST_ERROR_CODES.IP_ADDRESS_NOT_ALLOWED);
}
