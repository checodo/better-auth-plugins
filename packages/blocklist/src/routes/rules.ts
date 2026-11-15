import type { BetterAuthPlugin } from "@better-auth/core";
import { isAdmin } from "@repo/plugin-utils/admin";
import { recordAuditEvent } from "@repo/plugin-utils/audit";
import { APIError, createAuthEndpoint, sessionMiddleware } from "better-auth/api";
import * as z from "zod";
import { normalizeSettings } from "../check";
import { BLOCKLIST_ERROR_CODES } from "../error-codes";
import {
  createStoredRule,
  deleteStoredRule,
  findStoredRule,
  findStoredRuleById,
  listStoredRules,
} from "../store";
import type { ResolvedBlocklistOptions } from "../types";
import {
  hasUppercaseLiteral,
  isSafeRegexSource,
  normalizeRuleValue,
  RULE_TYPES_BY_TARGET,
} from "../utils/matchers";

/**
 * Longest stored rule value. The unique index on (target, type, value)
 * makes the column a bounded string on MySQL and SQL Server, and index
 * entries are size-limited on Postgres too.
 */
export const MAX_RULE_VALUE_LENGTH = 255;

const targetSchema = z
  .enum(["email", "username", "organization", "team", "password", "ip"])
  .meta({ description: "The kind of value the rule applies to" });
const matchTypeSchema = z
  .enum(["exact", "domain", "prefix", "suffix", "contains", "regex", "cidr", "country"])
  .meta({ description: "How the rule value is matched. Defaults to `exact`" });

export function createRuleEndpoints(options: ResolvedBlocklistOptions) {
  const assertCanManage = (user: { id: string; role?: unknown }) => {
    if (!isAdmin(user, options)) {
      throw APIError.from(
        "FORBIDDEN",
        BLOCKLIST_ERROR_CODES.YOU_ARE_NOT_ALLOWED_TO_MANAGE_BLOCKLIST_RULES,
      );
    }
  };

  return {
    listBlocklistRules: createAuthEndpoint(
      "/blocklist/list-rules",
      {
        method: "GET",
        use: [sessionMiddleware],
        query: z.optional(z.object({ target: targetSchema.optional() })),
        metadata: { openapi: { description: "List the blocklist rules stored in the database" } },
      },
      async (ctx) => {
        assertCanManage(ctx.context.session.user);
        const rules = await listStoredRules(ctx.context.adapter, ctx.query?.target);
        return ctx.json({ rules });
      },
    ),
    createBlocklistRule: createAuthEndpoint(
      "/blocklist/create-rule",
      {
        method: "POST",
        use: [sessionMiddleware],
        body: z.object({
          target: targetSchema,
          value: z
            .string()
            .trim()
            .min(1)
            .max(MAX_RULE_VALUE_LENGTH)
            .meta({ description: "The value or pattern to block. Stored normalized" }),
          type: matchTypeSchema.default("exact"),
          reason: z.string().max(1000).optional().meta({ description: "Why the value is blocked" }),
        }),
        metadata: { openapi: { description: "Create a blocklist rule" } },
      },
      async (ctx) => {
        assertCanManage(ctx.context.session.user);
        const { target, value, type, reason } = ctx.body;

        if (!options.targets[target].useDatabase) {
          throw APIError.from(
            "BAD_REQUEST",
            BLOCKLIST_ERROR_CODES.DATABASE_RULES_DISABLED_FOR_TARGET,
          );
        }
        if (type === "domain" && target !== "email") {
          throw APIError.from("BAD_REQUEST", BLOCKLIST_ERROR_CODES.DOMAIN_RULE_ONLY_FOR_EMAIL);
        }
        if (!RULE_TYPES_BY_TARGET[target].includes(type)) {
          throw APIError.from(
            "BAD_REQUEST",
            BLOCKLIST_ERROR_CODES.RULE_TYPE_NOT_SUPPORTED_FOR_TARGET,
          );
        }
        if (type === "regex" && !isSafeRegexSource(value)) {
          throw APIError.from("BAD_REQUEST", BLOCKLIST_ERROR_CODES.INVALID_REGEX_RULE);
        }
        if (type === "regex" && hasUppercaseLiteral(value)) {
          throw APIError.from("BAD_REQUEST", BLOCKLIST_ERROR_CODES.REGEX_RULE_MUST_BE_LOWERCASE);
        }
        if (type === "country" && !options.ip.getCountry) {
          throw APIError.from(
            "BAD_REQUEST",
            BLOCKLIST_ERROR_CODES.COUNTRY_RULES_REQUIRE_GET_COUNTRY,
          );
        }

        // Store the value the way it is matched (lowercase, normalized, a
        // domain without a leading "@", an IP address or range in canonical
        // form), so equivalent rules are duplicates. Regular expressions are
        // stored as written.
        const normalized = normalizeRuleValue(target, { type, value }, normalizeSettings(options));
        if (normalized === null) {
          throw APIError.from("BAD_REQUEST", BLOCKLIST_ERROR_CODES.INVALID_IP_RULE);
        }
        const stored = { target, type, value: normalized };
        if (stored.value.length > MAX_RULE_VALUE_LENGTH) {
          throw APIError.from("BAD_REQUEST", BLOCKLIST_ERROR_CODES.RULE_VALUE_TOO_LONG);
        }
        if (await findStoredRule(ctx.context.adapter, stored)) {
          throw APIError.from("BAD_REQUEST", BLOCKLIST_ERROR_CODES.RULE_ALREADY_EXISTS);
        }

        let rule: Awaited<ReturnType<typeof createStoredRule>>;
        try {
          rule = await createStoredRule(ctx.context.adapter, { ...stored, reason });
        } catch (error) {
          // A concurrent request created the same rule first (unique index).
          if (await findStoredRule(ctx.context.adapter, stored)) {
            throw APIError.from("BAD_REQUEST", BLOCKLIST_ERROR_CODES.RULE_ALREADY_EXISTS);
          }
          throw error;
        }
        options.databaseRules.clear();
        await recordAuditEvent({
          type: "blocklist.rule-created",
          severity: "high",
          metadata: { ruleId: rule.id, target, type, value: rule.value },
        });
        return ctx.json({ rule });
      },
    ),
    deleteBlocklistRule: createAuthEndpoint(
      "/blocklist/delete-rule",
      {
        method: "POST",
        use: [sessionMiddleware],
        body: z.object({ id: z.string().min(1).meta({ description: "The id of the rule" }) }),
        metadata: { openapi: { description: "Delete a blocklist rule" } },
      },
      async (ctx) => {
        assertCanManage(ctx.context.session.user);
        const rule = await findStoredRuleById(ctx.context.adapter, ctx.body.id);
        if (!rule) throw APIError.from("NOT_FOUND", BLOCKLIST_ERROR_CODES.RULE_NOT_FOUND);
        await deleteStoredRule(ctx.context.adapter, ctx.body.id);
        options.databaseRules.clear();
        await recordAuditEvent({
          type: "blocklist.rule-deleted",
          severity: "high",
          metadata: { ruleId: rule.id, target: rule.target, type: rule.type, value: rule.value },
        });
        return ctx.json({ success: true });
      },
    ),
  } satisfies BetterAuthPlugin["endpoints"];
}
