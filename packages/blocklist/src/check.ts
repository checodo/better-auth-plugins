import type { AuthContext } from "@better-auth/core";
import { getCurrentAdapter } from "@better-auth/core/context";
import { recordAuditEvent } from "@repo/plugin-utils/audit";
import { APIError } from "better-auth/api";
import type { BlocklistErrorCode } from "./error-codes";
import { BLOCKLIST_ERROR_CODES } from "./error-codes";
import { listStoredRules } from "./store";
import type { BlocklistTarget, CompiledRule, ResolvedBlocklistOptions } from "./types";
import type { NormalizeSettings } from "./utils/matchers";
import { compileRule, normalizeTargetValue } from "./utils/matchers";
import { RuleSet } from "./utils/rule-set";

const ERROR_CODE_BY_TARGET: Record<BlocklistTarget, BlocklistErrorCode> = {
  email: "EMAIL_NOT_ALLOWED",
  username: "USERNAME_NOT_ALLOWED",
  organization: "ORGANIZATION_NAME_NOT_ALLOWED",
  team: "TEAM_NAME_NOT_ALLOWED",
};

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
 * Returns the first rule of `target` that blocks `rawValue`, or `null`.
 * Static rules are checked first; database rules (cached, see
 * `databaseCacheTtl`) only when none of them match and the target uses
 * database rules.
 */
export async function findBlockingRule(
  adapter: Adapter,
  options: ResolvedBlocklistOptions,
  target: BlocklistTarget,
  rawValue: string,
): Promise<CompiledRule | null> {
  const settings = normalizeSettings(options);
  const targetOptions = options.targets[target];
  const value = normalizeTargetValue(target, rawValue, settings);

  if (targetOptions.allow.has(value)) return null;

  const staticMatch = targetOptions.rules.match(value);
  if (staticMatch) return staticMatch;
  if (!targetOptions.useDatabase) return null;

  const stored = await options.databaseRules.get(target, () =>
    loadDatabaseRules(adapter, target, settings),
  );
  return stored.match(value);
}

/**
 * Throws a 400 `APIError` if `rawValue` is blocked for `target`. Does
 * nothing for empty values. `notify: false` skips `onBlocked`, for checks
 * that don't create or change anything (availability checks). Errors from
 * `onBlocked` are logged, never returned to the client.
 */
export async function assertNotBlocked(
  adapter: Adapter,
  options: ResolvedBlocklistOptions,
  target: BlocklistTarget,
  rawValue: unknown,
  { notify = true, logger }: { notify?: boolean; logger?: Logger | undefined } = {},
): Promise<void> {
  if (typeof rawValue !== "string" || rawValue.trim() === "") return;

  const match = await findBlockingRule(adapter, options, target, rawValue);
  if (!match) return;

  if (notify) {
    if (options.onBlocked) {
      try {
        await options.onBlocked({ target, value: rawValue, rule: match.rule });
      } catch (error) {
        (logger ?? console).error("[blocklist] onBlocked threw an error", error);
      }
    }
    await recordAuditEvent({
      type: "blocklist.blocked",
      status: "failure",
      severity: "medium",
      errorCode: options.genericErrorMessage ? "VALUE_NOT_ALLOWED" : ERROR_CODE_BY_TARGET[target],
      metadata: {
        target,
        value: rawValue.slice(0, 255),
        rule: { type: match.rule.type, value: match.rule.value },
      },
    });
  }

  throw APIError.from(
    "BAD_REQUEST",
    BLOCKLIST_ERROR_CODES[
      options.genericErrorMessage ? "VALUE_NOT_ALLOWED" : ERROR_CODE_BY_TARGET[target]
    ],
  );
}
