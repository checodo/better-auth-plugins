import { createFail } from "@repo/plugin-utils/options";
import type {
  ResolvedSecurityAlertsOptions,
  SecurityAlertsEmailChangeAction,
  SecurityAlertsOptions,
  SecurityAlertsPasswordAction,
  SecurityAlertType,
} from "./types";
import { deviceFromHeaders } from "./utils/device";

export const ALERT_TYPES = [
  "new-device",
  "password-changed",
  "password-reset-requested",
  "password-reset",
  "email-changed",
  "passkey-added",
  "passkey-removed",
  "two-factor-disabled",
  "account-linked",
  "api-key-created",
] as const satisfies readonly SecurityAlertType[];

const PASSWORD_ACTIONS: readonly SecurityAlertsPasswordAction[] = ["block", "send-reset", "none"];
const EMAIL_CHANGE_ACTIONS: readonly SecurityAlertsEmailChangeAction[] = ["keep", "restore"];

const DAY = 86_400;
const DEFAULT_DEVICE_EXPIRES_IN = 90 * DAY;
const DEFAULT_MAX_DEVICES = 20;
const DEFAULT_SECURE_ACCOUNT_EXPIRES_IN = 7 * DAY;
/** Longest duration an option may set, in seconds (about 100 years), so dates stay valid. */
const MAX_SECONDS = 36_500 * DAY;

const fail = createFail("security-alerts");

function assertDuration(name: string, value: number | undefined) {
  if (value !== undefined && !(Number.isFinite(value) && value > 0 && value <= MAX_SECONDS)) {
    fail(`"${name}" must be a positive number of seconds up to ${MAX_SECONDS}, got ${value}.`);
  }
}

/** Resolves defaults and validates the options once, at plugin creation. */
export function resolveOptions(options: SecurityAlertsOptions): ResolvedSecurityAlertsOptions {
  if (typeof options?.sendAlert !== "function") {
    fail('"sendAlert" is required: the function that sends the alerts.');
  }

  const alerts = Object.fromEntries(ALERT_TYPES.map((type) => [type, true])) as Record<
    SecurityAlertType,
    boolean
  >;
  for (const [type, enabled] of Object.entries(options.alerts ?? {})) {
    if (!(ALERT_TYPES as readonly string[]).includes(type)) {
      fail(`Unknown alert type "${type}" in "alerts". Known types: ${ALERT_TYPES.join(", ")}.`);
    }
    if (enabled !== undefined) alerts[type as SecurityAlertType] = enabled;
  }

  const newDevice = options.newDevice ?? {};
  assertDuration("newDevice.expiresIn", newDevice.expiresIn);
  const maxDevices = newDevice.maxDevices ?? DEFAULT_MAX_DEVICES;
  if (!Number.isInteger(maxDevices) || maxDevices < 1) {
    fail(`"newDevice.maxDevices" must be a positive integer, got ${maxDevices}.`);
  }

  let secureAccount: ResolvedSecurityAlertsOptions["secureAccount"] = null;
  if (options.secureAccount) {
    const { callbackURL, expiresIn, resetPasswordURL } = options.secureAccount;
    const password = options.secureAccount.password ?? "block";
    if (typeof callbackURL !== "string" || callbackURL.trim() === "") {
      fail('"secureAccount.callbackURL" is required: the page the "This wasn\'t me" link opens.');
    }
    assertDuration("secureAccount.expiresIn", expiresIn);
    if (!PASSWORD_ACTIONS.includes(password)) {
      fail(
        `"secureAccount.password" must be one of ${PASSWORD_ACTIONS.join(", ")}, got ${password}.`,
      );
    }
    const emailChange = options.secureAccount.emailChange ?? "keep";
    if (!EMAIL_CHANGE_ACTIONS.includes(emailChange)) {
      fail(
        `"secureAccount.emailChange" must be one of ${EMAIL_CHANGE_ACTIONS.join(", ")}, got ${emailChange}.`,
      );
    }
    const { onSecured } = options.secureAccount;
    if (onSecured !== undefined && typeof onSecured !== "function") {
      fail('"secureAccount.onSecured" must be a function.');
    }
    if (password !== "none" && !resetPasswordURL?.trim()) {
      fail(
        `"secureAccount.resetPasswordURL" is required with password: "${password}": the page the reset link leads to. Or set password: "none".`,
      );
    }
    secureAccount = {
      callbackURL,
      expiresIn: (expiresIn ?? DEFAULT_SECURE_ACCOUNT_EXPIRES_IN) * 1000,
      password,
      resetPasswordURL,
      emailChange,
      onSecured,
    };
  }

  return {
    sendAlert: options.sendAlert,
    alerts,
    newDevice: {
      includeIp: newDevice.includeIp ?? false,
      expiresIn: (newDevice.expiresIn ?? DEFAULT_DEVICE_EXPIRES_IN) * 1000,
      maxDevices,
      isNewDevice: newDevice.isNewDevice,
      getDevice: newDevice.getDevice ?? deviceFromHeaders,
    },
    secureAccount,
    adminActions: {
      alert: options.adminActions?.alert ?? true,
      showActor: options.adminActions?.showActor ?? true,
    },
  };
}
