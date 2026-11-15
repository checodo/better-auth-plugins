import { resolveAdminOptions } from "@repo/plugin-utils/admin";
import { createFail } from "@repo/plugin-utils/options";
import type {
  BlocklistIpScope,
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
import { compileRule, hasUppercaseLiteral, RULE_TYPES_BY_TARGET } from "./utils/matchers";
import { RuleSet } from "./utils/rule-set";

// Annotated, so TypeScript narrows after `if (!x) fail(...)`.
const fail: (message: string) => never = createFail("blocklist");

/** Why a static rule doesn't compile, for the error thrown at startup. */
function invalidRuleReason(target: BlocklistTarget, rule: BlocklistRule): string {
  if (rule.type === "domain" && target !== "email") {
    return "Domain rules are only supported for the email target.";
  }
  if (!RULE_TYPES_BY_TARGET[target].includes(rule.type)) {
    return `The ${target} target takes ${RULE_TYPES_BY_TARGET[target].map((type) => `"${type}"`).join(", ")} rules.`;
  }
  switch (rule.type) {
    case "regex":
      return "The regular expression is invalid, too long, or potentially slow.";
    case "cidr":
      return 'It is not a CIDR range such as "203.0.113.0/24" or "2001:db8::/32".';
    case "country":
      return 'It is not a two-letter country code such as "KP".';
    default:
      return target === "ip" && rule.value.includes("/")
        ? 'It is not an IP address. Use a "cidr" rule (or the `ranges` option) for ranges.'
        : "It is not an IP address.";
  }
}

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
  options: Pick<BlocklistTargetOptions, "useDatabase"> | undefined,
  settings: NormalizeSettings,
): ResolvedTargetOptions {
  const compiled = new RuleSet();
  for (const rule of rules) {
    const result = compileRule(target, rule, settings);
    if (!result) {
      fail(
        `Invalid ${target} rule ${JSON.stringify(rule.value)} of type "${rule.type}". ` +
          invalidRuleReason(target, rule),
      );
    }
    if (rule.type === "regex" && hasUppercaseLiteral(rule.value)) {
      fail(
        `The ${target} regex rule ${JSON.stringify(rule.value)} contains uppercase letters. ` +
          "Values are lowercased before matching, so write the pattern in lowercase.",
      );
    }
    compiled.add(result);
  }

  // Allowed IPs may be addresses or ranges; other targets' entries are exact values.
  const allow = new RuleSet();
  const allowed = (options as { allow?: readonly string[] } | undefined)?.allow ?? [];
  for (const value of allowed) {
    const type = target === "ip" && value.includes("/") ? "cidr" : "exact";
    const result = compileRule(target, { value, type }, settings);
    if (!result) fail(`Invalid ${target} allow entry ${JSON.stringify(value)}.`);
    allow.add(result);
  }

  return { rules: compiled, allow, useDatabase: options?.useDatabase ?? true };
}

const IP_SCOPES: readonly BlocklistIpScope[] = ["sign-up", "sign-in"];

/** Resolves defaults and compiles the static rules once, at plugin creation. */
export function resolveOptions(options: BlocklistOptions): ResolvedBlocklistOptions {
  const settings: NormalizeSettings = {
    full: options.normalize ?? true,
    stripPlusAddressing: options.email?.stripPlusAddressing ?? true,
  };
  const values = (target: Pick<BlocklistTargetOptions, "values"> | undefined) =>
    (target?.values ?? []).map((value) => toRule(value));

  const ipRules = [
    ...values(options.ip),
    ...(options.ip?.ranges ?? []).map((value) => toRule(value, "cidr")),
    ...(options.ip?.countries ?? []).map((value) => toRule(value, "country")),
  ];
  if (ipRules.some((rule) => rule.type === "country") && !options.ip?.getCountry) {
    fail("Country rules need `ip.getCountry`, which returns the country of a request.");
  }
  const scope = options.ip?.scope ?? IP_SCOPES;
  for (const entry of scope) {
    if (!IP_SCOPES.includes(entry)) {
      fail(`Unknown ip scope ${JSON.stringify(entry)}. Use "sign-up" and/or "sign-in".`);
    }
  }

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
      password: resolveTarget("password", values(options.password), options.password, settings),
      ip: resolveTarget("ip", ipRules, options.ip, settings),
    },
    password: { checkContext: !!options.password && options.password.checkContext !== false },
    ip: { scope: new Set(scope), getCountry: options.ip?.getCountry },
  };
}
