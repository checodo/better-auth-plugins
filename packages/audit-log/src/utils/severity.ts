import type { AuditEventSeverity, AuditEventStatus } from "../types";

const BUILT_IN: Record<string, AuditEventSeverity> = {
  "sign-up": "low",
  "sign-in": "low",
  "sign-out": "low",
  "email-verified": "low",
  "session-revoked": "medium",
  "account-linked": "medium",
  "account-unlinked": "medium",
  "email-changed": "medium",
  "password-changed": "medium",
  "password-reset": "medium",
  "user-deleted": "high",
  "two-factor-enabled": "medium",
  "two-factor-disabled": "high",
  "organization.deleted": "high",
  "organization.member-removed": "medium",
  "organization.member-role-changed": "high",
  "admin.set-role": "critical",
  "admin.set-user-password": "critical",
  "admin.impersonate-user": "critical",
};

/**
 * The severity of an event: the `severity` option, then the built-in
 * table. Admin actions are `high` unless listed; failed sign-ins `medium`;
 * anything else `low`.
 */
export function severityOf(
  type: string,
  status: AuditEventStatus,
  overrides: Readonly<Record<string, AuditEventSeverity>>,
): AuditEventSeverity {
  const override = overrides[type];
  if (override) return override;
  if (type === "sign-in" && status === "failure") return "medium";
  return BUILT_IN[type] ?? (type.startsWith("admin.") ? "high" : "low");
}
