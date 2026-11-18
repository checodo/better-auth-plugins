import { defineErrorCodes } from "@better-auth/core/utils/error-codes";

export const AUDIT_LOG_ERROR_CODES = defineErrorCodes({
  YOU_ARE_NOT_ALLOWED_TO_LIST_OTHER_USERS_EVENTS:
    "You are not allowed to list the audit events of other users",
  METADATA_TOO_LARGE: "The metadata is too large",
  RETENTION_NOT_CONFIGURED: "Pass `days`, or configure the plugin's `retention` option",
  HASH_CHAIN_NOT_ENABLED: "The plugin's `hashChain` option is off",
  READ_NOT_SUPPORTED: "The audit log's storage can't be read",
  DELETE_NOT_SUPPORTED: "The audit log's storage can't delete events",
});

export type AuditLogErrorCode = keyof typeof AUDIT_LOG_ERROR_CODES;
