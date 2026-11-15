import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

export const BLOCKLIST_ERROR_CODES = defineErrorCodes({
  EMAIL_NOT_ALLOWED: "This email address is not allowed",
  USERNAME_NOT_ALLOWED: "This username is not allowed",
  ORGANIZATION_NAME_NOT_ALLOWED: "This organization name is not allowed",
  TEAM_NAME_NOT_ALLOWED: "This team name is not allowed",
  PASSWORD_NOT_ALLOWED: "This password is not allowed",
  PASSWORD_CONTAINS_CONTEXT_WORD:
    "The password must not contain your email address, your username, or the name of this app",
  IP_ADDRESS_NOT_ALLOWED: "Signing up or signing in from this network or location is not allowed",
  VALUE_NOT_ALLOWED: "This value is not allowed",
  YOU_ARE_NOT_ALLOWED_TO_MANAGE_BLOCKLIST_RULES: "You are not allowed to manage blocklist rules",
  RULE_ALREADY_EXISTS: "A rule with this target, type, and value already exists",
  RULE_NOT_FOUND: "No rule was found with this id",
  INVALID_REGEX_RULE: "The regular expression is invalid, too long, or potentially slow",
  DOMAIN_RULE_ONLY_FOR_EMAIL: "Domain rules are only supported for the email target",
  RULE_TYPE_NOT_SUPPORTED_FOR_TARGET: "This rule type is not supported for this target",
  INVALID_IP_RULE: "The IP address, CIDR range, or country code is invalid",
  COUNTRY_RULES_REQUIRE_GET_COUNTRY: "Country rules require the ip.getCountry option",
  DATABASE_RULES_DISABLED_FOR_TARGET: "Database rules are disabled for this target",
  REGEX_RULE_MUST_BE_LOWERCASE:
    "The regular expression contains uppercase letters, which never match normalized values",
  RULE_VALUE_TOO_LONG: "The rule value is too long",
});

export type BlocklistErrorCode = keyof typeof BLOCKLIST_ERROR_CODES;
