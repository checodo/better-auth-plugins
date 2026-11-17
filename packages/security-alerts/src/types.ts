import type { User } from "@better-auth/core/db";
import type { InferOptionSchema } from "better-auth";
import type { SecurityAlertsSchema } from "./schema";

/**
 * What happened to the account:
 *
 * - `new-device`                a sign-in from a browser or device not seen before
 * - `password-changed`          the password was changed (by the user or an admin)
 * - `password-reset-requested`  someone asked for a password reset link or code
 * - `password-reset`            the password was set with a reset link or code
 * - `email-changed`             the email address changed; sent to the **old** address
 * - `passkey-added`             a passkey was registered (passkey plugin)
 * - `passkey-removed`           a passkey was deleted (passkey plugin)
 * - `two-factor-disabled`       two-factor authentication was turned off (two-factor plugin)
 * - `account-linked`            a social or other account was linked
 * - `api-key-created`           an API key was created (api-key plugin)
 */
export type SecurityAlertType =
  | "new-device"
  | "password-changed"
  | "password-reset-requested"
  | "password-reset"
  | "email-changed"
  | "passkey-added"
  | "passkey-removed"
  | "two-factor-disabled"
  | "account-linked"
  | "api-key-created";

/** The browser and operating system a request came from, as far as it tells. */
export interface SecurityAlertDevice {
  /** Browser family, e.g. `"Chrome"`, `"Firefox"`, `"Safari"`. `null` when unknown. */
  browser: string | null;
  /** Operating system family, e.g. `"macOS"`, `"Windows"`, `"iOS"`. `null` when unknown. */
  os: string | null;
  /** For people: `"Chrome on macOS"`, `"Unknown browser on Windows"`, ... */
  label: string;
}

/** Where and how it happened. Fields that don't apply to an alert type are left out. */
export interface SecurityAlertDetails {
  /** When it happened. */
  at: Date;
  /** The IP address of the request, as better-auth sees it (`advanced.ipAddress`). */
  ipAddress: string | null;
  userAgent: string | null;
  /** The browser and OS of the request. */
  device: SecurityAlertDevice;
  /**
   * Who did it: the user, or an admin (e.g. the admin plugin's
   * `setUserPassword`). `null` with `adminActions.showActor: false`.
   */
  actor: "user" | "admin" | null;
  /** `account-linked`: the provider of the linked account, e.g. `"github"`. */
  providerId?: string | undefined;
  /** `passkey-added`, `passkey-removed`. */
  passkeyId?: string | undefined;
  /** `passkey-added`, `passkey-removed`: the name the user gave the passkey, if any. */
  passkeyName?: string | null | undefined;
  /** `api-key-created`. Never the key itself. */
  apiKeyId?: string | undefined;
  /** `api-key-created`. */
  apiKeyName?: string | null | undefined;
  /**
   * `email-changed`: the new address, masked (`j***@example.com`): the
   * alert goes to the old address, which may be in someone else's hands.
   */
  newEmail?: string | undefined;
  /** `password-reset-requested`, `password-reset`: how the link or code was sent. */
  channel?: "email" | "phone-number" | undefined;
}

/** What `sendAlert` receives. */
export interface SecurityAlert {
  type: SecurityAlertType;
  /** The user the alert is about (after the change). */
  user: User & Record<string, unknown>;
  /**
   * Where to send the alert: the user's email, or for `email-changed` the
   * old one.
   */
  email: string;
  details: SecurityAlertDetails;
  /**
   * The "This wasn't me" link for the alert: single use, expires after
   * `secureAccount.expiresIn`. `null` without the `secureAccount` option
   * and for `password-reset-requested` (that one says "ignore it if it
   * wasn't you").
   */
  secureAccountUrl: string | null;
}

/** What `newDevice.isNewDevice` receives. */
export interface SecurityAlertsDeviceCheck {
  user: User & Record<string, unknown>;
  device: SecurityAlertDevice;
  ipAddress: string | null;
  userAgent: string | null;
  /** The device matches one the user signed in from before (and it hasn't expired). */
  known: boolean;
  /**
   * The user has no devices on record: the first sign-in since the plugin
   * was added. Expired and forgotten devices still count as on record.
   */
  firstSignIn: boolean;
}

/** How sign-ins from new devices are detected. */
export interface SecurityAlertsNewDeviceOptions {
  /**
   * Also tell devices apart by network: the IP address's /24 (IPv4) or
   * /48 (IPv6) range. Phones and laptops change networks often, so this
   * alerts more. Defaults to `false`.
   */
  includeIp?: boolean | undefined;
  /**
   * A device counts as new again after this many seconds without a
   * sign-in from it: the next sign-in alerts again. Defaults to 90 days.
   */
  expiresIn?: number | undefined;
  /**
   * Remember at most this many devices per user; the least recently seen
   * are forgotten first. Defaults to `20`.
   */
  maxDevices?: number | undefined;
  /**
   * Decide yourself whether a sign-in is from a new device: return `true`
   * to alert, `false` not to, or `undefined` for the default (a device
   * that isn't known, except on the first sign-in). The device is
   * remembered either way.
   */
  isNewDevice?:
    | ((check: SecurityAlertsDeviceCheck) => boolean | undefined | Promise<boolean | undefined>)
    | undefined;
  /**
   * Read the browser and OS from the request headers yourself, e.g. with a
   * user-agent parser library. Defaults to a built-in parser that knows
   * the common browsers and systems, and prefers User-Agent Client Hints
   * (`Sec-CH-UA`, `Sec-CH-UA-Platform`) when the browser sends them.
   */
  getDevice?: ((headers: Headers) => { browser: string | null; os: string | null }) | undefined;
}

/**
 * What the "This wasn't me" link does about the password, besides signing
 * out every session:
 *
 * - `"block"`      the current password stops working, and a reset link is
 *                  sent (`emailAndPassword.sendResetPassword`); whoever knows
 *                  the old password can't sign in with it again
 * - `"send-reset"` a reset link is sent; the current password keeps working
 *                  until the user resets it
 * - `"none"`       nothing
 *
 * Only for users with a password. Without `sendResetPassword`,
 * `"block"` and `"send-reset"` act like `"none"` (and log a warning at
 * startup): a blocked password could not be reset.
 */
export type SecurityAlertsPasswordAction = "block" | "send-reset" | "none";

/**
 * What the "This wasn't me" link of an `email-changed` alert does about
 * the email address:
 *
 * - `"keep"`    the new address stays; the reset link goes there
 * - `"restore"` the old address (where the alert went) is put back and
 *               marked verified, unless another account has it by now; the
 *               reset link goes there
 */
export type SecurityAlertsEmailChangeAction = "keep" | "restore";

/** What `secureAccount.onSecured` receives. */
export interface SecurityAlertsSecuredAccount {
  /** The user, after securing (with the restored email, if any). */
  user: User & Record<string, unknown>;
  /** The alert whose link was used. */
  alert: SecurityAlertType;
  /** What happened to the password; `"none"` for users without one. */
  password: SecurityAlertsPasswordAction;
  /** What the alert was about and was removed, if anything. */
  removed: "passkey" | "account" | "apikey" | null;
  /** The email address that was put back (`emailChange: "restore"`), or `null`. */
  restoredEmail: string | null;
}

/** The "This wasn't me" link in alerts. */
export interface SecurityAlertsSecureAccountOptions {
  /**
   * The page of your app the link leads to, e.g. `"/secure-account"`. It
   * gets `?token=...` (or `?error=INVALID_TOKEN`) and asks the user to
   * confirm, then calls `secureAccount` with the token. The link itself
   * changes nothing, so mail scanners that open links can't trigger it.
   */
  callbackURL: string;
  /** How long the link works, in seconds. Defaults to 7 days. */
  expiresIn?: number | undefined;
  /** What happens to the password. Defaults to `"block"`. */
  password?: SecurityAlertsPasswordAction | undefined;
  /**
   * Your reset-password page, where the reset link sent by `"block"` and
   * `"send-reset"` leads (like `redirectTo` of `requestPasswordReset`).
   * Required unless `password` is `"none"`.
   */
  resetPasswordURL?: string | undefined;
  /**
   * For `email-changed` alerts: keep the new address, or put the old one
   * back. Defaults to `"keep"`. See {@link SecurityAlertsEmailChangeAction}.
   */
  emailChange?: SecurityAlertsEmailChangeAction | undefined;
  /**
   * Called after an account was secured, e.g. to revoke API keys kept
   * outside the database, open a support ticket, or tell your team. Runs
   * like `sendAlert`; errors are logged.
   */
  onSecured?:
    | ((secured: SecurityAlertsSecuredAccount, request?: Request) => void | Promise<void>)
    | undefined;
}

/** Changes an admin makes to someone else's account (admin plugin). */
export interface SecurityAlertsAdminActionsOptions {
  /** Alert the user about them. Defaults to `true`. */
  alert?: boolean | undefined;
  /**
   * Say in the alert that an admin did it (`details.actor: "admin"`).
   * With `false`, `details.actor` is `null` for every alert. Defaults to
   * `true`.
   */
  showActor?: boolean | undefined;
}

export interface SecurityAlertsOptions {
  /**
   * Sends an alert, e.g. an email to `alert.email`. Runs in the background
   * when better-auth's `advanced.backgroundTasks` is configured, so the
   * response doesn't wait for it; awaited otherwise. Errors are logged and
   * never reach the client.
   */
  sendAlert: (alert: SecurityAlert, request?: Request) => void | Promise<void>;
  /**
   * Turn single alert types off (or on again), e.g.
   * `{ "api-key-created": false }`. Every type is on by default; types
   * whose plugin isn't installed (passkey, two-factor, api-key) never
   * fire.
   */
  alerts?: Partial<Record<SecurityAlertType, boolean>> | undefined;
  /** How sign-ins from new devices are detected. See {@link SecurityAlertsNewDeviceOptions}. */
  newDevice?: SecurityAlertsNewDeviceOptions | undefined;
  /**
   * Add a "This wasn't me" link to the alerts. Without it,
   * `secureAccountUrl` is `null`. See {@link SecurityAlertsSecureAccountOptions}.
   */
  secureAccount?: SecurityAlertsSecureAccountOptions | undefined;
  /** Alerts about changes an admin makes. See {@link SecurityAlertsAdminActionsOptions}. */
  adminActions?: SecurityAlertsAdminActionsOptions | undefined;
  /** Rename the `knownDevice` table or its fields. */
  schema?: InferOptionSchema<SecurityAlertsSchema> | undefined;
}

/** The options with defaults applied, durations in milliseconds. */
export interface ResolvedSecurityAlertsOptions {
  sendAlert: SecurityAlertsOptions["sendAlert"];
  alerts: Record<SecurityAlertType, boolean>;
  newDevice: {
    includeIp: boolean;
    expiresIn: number;
    maxDevices: number;
    isNewDevice: SecurityAlertsNewDeviceOptions["isNewDevice"];
    getDevice: NonNullable<SecurityAlertsNewDeviceOptions["getDevice"]>;
  };
  secureAccount: {
    callbackURL: string;
    expiresIn: number;
    password: SecurityAlertsPasswordAction;
    resetPasswordURL: string | undefined;
    emailChange: SecurityAlertsEmailChangeAction;
    onSecured: SecurityAlertsSecureAccountOptions["onSecured"];
  } | null;
  adminActions: { alert: boolean; showActor: boolean };
}
