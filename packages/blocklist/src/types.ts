import type { InferOptionSchema } from "better-auth";
import type { BlocklistSchema } from "./schema";
import type { DatabaseRuleCache } from "./utils/database-rule-cache";
import type { RuleSet } from "./utils/rule-set";

/** The kinds of values the blocklist guards. */
export type BlocklistTarget = "email" | "username" | "organization" | "team";

/**
 * How a rule's `value` is compared with the checked value. Both sides are
 * normalized first (see `BlocklistOptions.normalize`), except the `regex`
 * pattern itself.
 *
 * - `exact`     the value equals the rule
 * - `domain`    emails only: the address's domain is the rule or a subdomain of it
 * - `prefix`    the value starts with the rule
 * - `suffix`    the value ends with the rule
 * - `contains`  the value contains the rule
 * - `regex`     the value matches the rule as a regular expression source
 */
export type BlocklistMatchType = "exact" | "domain" | "prefix" | "suffix" | "contains" | "regex";

export interface BlocklistRuleInput {
  /** The pattern to match against: an address, a domain, a username, a regex source, ... */
  value: string;
  /** Match strategy. Defaults to `"exact"`. */
  type?: BlocklistMatchType | undefined;
  /** Free-form note, e.g. "disposable email provider". */
  reason?: string | undefined;
}

export interface BlocklistRule {
  /** Set for rules stored in the database, absent for rules from the plugin options. */
  id?: string | undefined;
  value: string;
  type: BlocklistMatchType;
  reason?: string | undefined;
}

/** A rule as stored in the `blocklistRule` table. */
export interface StoredBlocklistRule {
  id: string;
  target: BlocklistTarget;
  type: BlocklistMatchType;
  value: string;
  reason?: string | null | undefined;
  createdAt: Date;
}

export interface BlocklistTargetOptions {
  /** Blocked values. A plain string is an `exact` rule. Merged with rules stored in the database. */
  values?: readonly (string | BlocklistRuleInput)[] | undefined;
  /** Values that are always allowed, even when a rule matches. Compared after normalization. */
  allow?: readonly string[] | undefined;
  /**
   * Also apply rules stored in the `blocklistRule` table (managed through
   * the rule endpoints). Defaults to `true`.
   */
  useDatabase?: boolean | undefined;
}

export interface BlocklistEmailOptions extends BlocklistTargetOptions {
  /** Blocked domains, including their subdomains. Shorthand for `{ value, type: "domain" }` rules. */
  domains?: readonly string[] | undefined;
  /** Blocked addresses. Shorthand for `exact` rules. */
  addresses?: readonly string[] | undefined;
  /**
   * Ignore a `+tag` in the local part when matching, so a rule for
   * `user@example.com` also matches `user+tag@example.com`. Defaults to `true`.
   */
  stripPlusAddressing?: boolean | undefined;
}

export interface BlocklistOptions {
  email?: BlocklistEmailOptions | undefined;
  /** Requires better-auth's `username` plugin. */
  username?: BlocklistTargetOptions | undefined;
  /** Checks organization names and slugs. Requires better-auth's `organization` plugin. */
  organization?: BlocklistTargetOptions | undefined;
  /** Checks team names. Requires better-auth's `organization` plugin with teams enabled. */
  team?: BlocklistTargetOptions | undefined;
  /**
   * Normalize values and rules before matching: trim, lowercase, Unicode
   * compatibility forms (fullwidth letters, ligatures), remove accents
   * (`ádmin`, Turkish `ADMİN`), remove invisible characters (zero-width
   * spaces, soft hyphens, ...), and fold common confusable characters (a
   * Cyrillic "а" to a Latin "a"). With `false`,
   * values are only trimmed and lowercased. Defaults to `true`.
   */
  normalize?: boolean | undefined;
  /**
   * Return a generic "This value is not allowed" error instead of naming
   * the blocked field. Defaults to `false`.
   */
  genericErrorMessage?: boolean | undefined;
  /**
   * Users with one of these roles (the `role` field of better-auth's
   * `admin` plugin) may manage database rules. Defaults to `["admin"]`.
   */
  adminRoles?: readonly string[] | undefined;
  /** Users with these ids may manage database rules, whatever their role. */
  adminUserIds?: readonly string[] | undefined;
  /**
   * Rename the `blocklistRule` table or its columns, like better-auth's own
   * plugins: `{ blocklistRule: { modelName: "blocklist_rules", fields: { createdAt: "created_at" } } }`.
   */
  schema?: InferOptionSchema<BlocklistSchema> | undefined;
  /**
   * How long rules stored in the database are cached, in milliseconds.
   * Changes made through this server's rule endpoints apply right away;
   * changes from other servers apply after at most this long. `0` reads
   * the database on every check. Defaults to `10_000`.
   */
  databaseCacheTtl?: number | undefined;
  /**
   * Called whenever a value is blocked, before the request fails. Errors
   * thrown here are logged and don't change the response.
   */
  onBlocked?:
    | ((details: {
        target: BlocklistTarget;
        value: string;
        rule: BlocklistRule;
      }) => void | Promise<void>)
    | undefined;
}

export interface ResolvedTargetOptions {
  /** Static rules from the plugin options, compiled and indexed. */
  rules: RuleSet;
  /** Normalized allow-list entries. */
  allow: Set<string>;
  useDatabase: boolean;
}

export interface ResolvedBlocklistOptions {
  normalize: boolean;
  stripPlusAddressing: boolean;
  genericErrorMessage: boolean;
  adminRoles: readonly string[];
  adminUserIds: readonly string[];
  onBlocked: BlocklistOptions["onBlocked"];
  targets: Record<BlocklistTarget, ResolvedTargetOptions>;
  /** Compiled database rules per target, see `databaseCacheTtl`. */
  databaseRules: DatabaseRuleCache;
}

/** A rule prepared for matching: normalized value, or a compiled regular expression. */
export interface CompiledRule {
  rule: BlocklistRule;
  value: string;
  regex?: RegExp | undefined;
}
