import { resolveAdminOptions } from "@repo/plugin-utils/admin";
import type {
  BlocklistOptions,
  BlocklistRule,
  BlocklistRuleInput,
  BlocklistTarget,
  BlocklistTargetOptions,
  ResolvedBlocklistOptions,
  ResolvedTargetOptions,
} from "./types";
import { DatabaseRuleCache } from "./utils/database-rule-cache";
import type { NormalizeSettings } from "./utils/matchers";
import { compileRule, hasUppercaseLiteral, normalizeTargetValue } from "./utils/matchers";
import { RuleSet } from "./utils/rule-set";

function toRule(
  input: string | BlocklistRuleInput,
  defaultType: BlocklistRule["type"] = "exact",
): BlocklistRule {
  if (typeof input === "string") return { value: input, type: defaultType };
  return { value: input.value, type: input.type ?? defaultType, reason: input.reason };
}

function resolveTarget(
  target: BlocklistTarget,
  rules: BlocklistRule[],
  options: BlocklistTargetOptions | undefined,
  settings: NormalizeSettings,
): ResolvedTargetOptions {
  const compiled = new RuleSet();
  for (const rule of rules) {
    const result = compileRule(target, rule, settings);
    if (!result) {
      throw new Error(
        `[blocklist] Invalid ${target} rule ${JSON.stringify(rule.value)} of type "${rule.type}". ` +
          (rule.type === "domain"
            ? "Domain rules are only supported for the email target."
            : "The regular expression is invalid, too long, or potentially slow."),
      );
    }
    if (rule.type === "regex" && hasUppercaseLiteral(rule.value)) {
      throw new Error(
        `[blocklist] The ${target} regex rule ${JSON.stringify(rule.value)} contains uppercase letters. ` +
          "Values are lowercased before matching, so write the pattern in lowercase.",
      );
    }
    compiled.add(result);
  }

  return {
    rules: compiled,
    allow: new Set(
      (options?.allow ?? []).map((value) => normalizeTargetValue(target, value, settings)),
    ),
    useDatabase: options?.useDatabase ?? true,
  };
}

/** Resolves defaults and compiles the static rules once, at plugin creation. */
export function resolveOptions(options: BlocklistOptions): ResolvedBlocklistOptions {
  const settings: NormalizeSettings = {
    full: options.normalize ?? true,
    stripPlusAddressing: options.email?.stripPlusAddressing ?? true,
  };
  const values = (target: BlocklistTargetOptions | undefined) =>
    (target?.values ?? []).map((value) => toRule(value));

  return {
    normalize: settings.full,
    stripPlusAddressing: settings.stripPlusAddressing,
    genericErrorMessage: options.genericErrorMessage ?? false,
    ...resolveAdminOptions(options),
    onBlocked: options.onBlocked,
    databaseRules: new DatabaseRuleCache(options.databaseCacheTtl ?? 10_000),
    targets: {
      email: resolveTarget(
        "email",
        [
          ...values(options.email),
          ...(options.email?.domains ?? []).map((value) => toRule(value, "domain")),
          ...(options.email?.addresses ?? []).map((value) => toRule(value, "exact")),
        ],
        options.email,
        settings,
      ),
      username: resolveTarget("username", values(options.username), options.username, settings),
      organization: resolveTarget(
        "organization",
        values(options.organization),
        options.organization,
        settings,
      ),
      team: resolveTarget("team", values(options.team), options.team, settings),
    },
  };
}
