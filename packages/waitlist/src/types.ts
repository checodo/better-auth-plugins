import type { GenericEndpointContext } from "@better-auth/core";
import type { InferOptionSchema } from "better-auth";
import type { WaitlistSchema } from "./schema";

/**
 * Where an entry is in the waitlist:
 *
 * - `unconfirmed` joined, but hasn't confirmed the email yet (see `confirmEmail`)
 * - `pending`     joined, waiting for approval
 * - `approved`    may create an account (until the invite expires)
 * - `rejected`    may not create an account
 * - `registered`  created an account; the invite is used up
 */
export type WaitlistEntryStatus =
  | "unconfirmed"
  | "pending"
  | "approved"
  | "rejected"
  | "registered";

/** An entry as stored in the `waitlistEntry` table. */
export interface WaitlistEntry {
  id: string;
  /** Trimmed and lowercased. */
  email: string;
  status: WaitlistEntryStatus;
  /**
   * SHA-256 hash of the token that identifies the entry in links sent to
   * its email (confirm the email, see the status, leave the waitlist). The
   * token itself is only sent by email, and passed to `onJoin`.
   */
  tokenHash: string;
  /**
   * How many confirmation emails were sent for this entry (double opt-in).
   * Limited to `MAX_CONFIRMATION_EMAILS`, so the join form can't be used
   * to flood an inbox.
   */
  confirmationsSent: number;
  /**
   * SHA-256 hash of the invite code, set while the entry is `approved`;
   * cleared once it is used or the entry is rejected.
   */
  inviteCodeHash?: string | null | undefined;
  inviteExpiresAt?: Date | null | undefined;
  /** JSON-encoded `metadata` from `/waitlist/join`. */
  metadata?: string | null | undefined;
  /**
   * When the person confirmed the email through the confirmation link
   * (`confirmEmail`). `null` when nobody confirmed it: without
   * `confirmEmail`, for emails an admin invited directly (`createInvite`)
   * before they confirmed, and for entries confirmed before this field
   * existed.
   */
  confirmedAt?: Date | null | undefined;
  /** Id of the admin who approved the entry. */
  approvedBy?: string | null | undefined;
  approvedAt?: Date | null | undefined;
  registeredAt?: Date | null | undefined;
  createdAt: Date;
  updatedAt: Date;
}

/** An entry without the hashes of its secrets. */
type PublicEntry = Omit<WaitlistEntry, "tokenHash" | "inviteCodeHash">;

/**
 * An entry as the admin endpoints (and `onReject`) see it: without its
 * token, which only the person gets. `inviteCode` is the plain invite code
 * in the responses of `approveEntries` and `createInvite`, which issue it,
 * and `null` everywhere else: only its hash is stored.
 */
export type WaitlistAdminEntry = PublicEntry & { inviteCode: string | null };

/** What `onJoin` receives: the entry with its plain `token`, e.g. for a status link. */
export type WaitlistJoinedEntry = PublicEntry & { token: string };

/** What `sendInvite` receives when an entry is approved or someone is invited directly. */
export interface WaitlistInvite {
  email: string;
  /** Single-use code, bound to `email`. Put it in the sign-up link. */
  inviteCode: string;
  /** `null` when invites don't expire (`inviteExpiresIn: 0`). */
  expiresAt: Date | null;
  /**
   * The entry's token, for status and "leave the waitlist" links. When an
   * admin approves the entry, it is a new token: links from earlier
   * emails stop working.
   */
  token: string;
}

/** What `sendConfirmationEmail` receives when someone joins. */
export interface WaitlistConfirmation {
  email: string;
  /**
   * Put it in the confirmation link; the page calls `/waitlist/confirm`
   * with it. A resend gets a new token, and the old link stops working.
   */
  token: string;
  /** When the link stops working (`confirmationExpiresIn`). */
  expiresAt: Date;
}

/** How long entries that are no longer waiting are kept, and how often expired ones are deleted. */
export interface WaitlistRetention {
  /**
   * Delete rejected entries this many days after they were rejected (or
   * last changed). The email can then join again. Kept until an admin
   * deletes them by default.
   */
  rejected?: number | undefined;
  /**
   * Delete registered entries this many days after the account was
   * created. Kept until an admin deletes them by default.
   */
  registered?: number | undefined;
  /**
   * At most one cleanup per this many seconds, started in the background
   * by a waitlist request. Also deletes unconfirmed entries whose link has
   * expired, with or without `rejected` and `registered`. Defaults to
   * `3600`. Call `auth.api.deleteExpiredWaitlistEntries` from a cron job
   * instead, or as well.
   */
  sweepInterval?: number | undefined;
}

export interface WaitlistOptions {
  /**
   * Only let approved emails create an account. With `false`, the
   * waitlist still collects entries but sign-up is open, e.g. to collect
   * interest before a launch or after it. Defaults to `true`.
   */
  enabled?: boolean | undefined;
  /**
   * Approve new entries right away: `true` for all, or a function that
   * decides per email (e.g. a partner domain). Defaults to `false`.
   */
  autoApprove?: boolean | ((email: string) => boolean | Promise<boolean>) | undefined;
  /**
   * Require the invite code at sign-up, not just an approved email: in
   * the `/sign-up/email` body (`inviteCode`), the OAuth `additionalData`
   * (`{ inviteCode }`), or an `x-invite-code` header. Defaults to `false`.
   */
  requireInviteCode?: boolean | undefined;
  /**
   * How long an approval (and its invite code) lasts, in seconds. `0`
   * means it never expires. Defaults to 7 days.
   */
  inviteExpiresIn?: number | undefined;
  /**
   * Double opt-in: new entries stay `unconfirmed` until the person opens
   * the link sent by `sendConfirmationEmail`, so nobody can put someone
   * else's email on the waitlist. Only confirmed entries can be approved.
   * Requires `sendConfirmationEmail`. Defaults to `true`.
   */
  confirmEmail?: boolean | undefined;
  /**
   * Sends the confirmation email for `confirmEmail`. Build a link to a
   * page of your app that calls `/waitlist/confirm` with the token. Runs
   * like `onJoin`. Errors are logged.
   */
  sendConfirmationEmail?:
    | ((confirmation: WaitlistConfirmation) => void | Promise<void>)
    | undefined;
  /**
   * How long a confirmation link works, in seconds. Unconfirmed entries
   * older than this are deleted. Defaults to 2 days.
   */
  confirmationExpiresIn?: number | undefined;
  /**
   * Delete rejected and registered entries after a number of days, and
   * how often to clean up. Unconfirmed entries are always deleted once
   * their link has expired. See {@link WaitlistRetention}.
   */
  retention?: WaitlistRetention | undefined;
  /**
   * Emails (`"ceo@acme.com"`) and domains (`"acme.com"`, including
   * subdomains) that may always create an account, waitlist or not.
   */
  allow?: readonly string[] | undefined;
  /**
   * Lets a user be created without passing the waitlist, based on the
   * request that creates it. `context` is `null` for users created by
   * server code outside a request. Defaults to users created through the
   * admin plugin's `/admin/create-user`.
   */
  bypass?: ((context: GenericEndpointContext | null) => boolean) | undefined;
  /**
   * Stop accepting new entries once this many people are waiting (`pending`
   * or `approved`). Unconfirmed, rejected, and registered entries don't
   * count. Unlimited by default.
   */
  maxEntries?: number | undefined;
  /**
   * Users with one of these roles (the `role` field of better-auth's
   * `admin` plugin) may manage the waitlist. Defaults to `["admin"]`.
   */
  adminRoles?: readonly string[] | undefined;
  /** Users with these ids may manage the waitlist, whatever their role. */
  adminUserIds?: readonly string[] | undefined;
  /**
   * Rename the `waitlistEntry` table or its columns, like better-auth's
   * own plugins: `{ waitlistEntry: { modelName: "waitlist", fields: { createdAt: "created_at" } } }`.
   */
  schema?: InferOptionSchema<WaitlistSchema> | undefined;
  /**
   * Called when an email is added to the waitlist: when it is confirmed
   * with `confirmEmail`, otherwise right after joining. Runs in the background when
   * `advanced.backgroundTasks` is configured, so the response time doesn't
   * reveal whether the email was new. `entry.token` is the plain token,
   * e.g. for a status link. Errors are logged.
   */
  onJoin?: ((entry: WaitlistJoinedEntry) => void | Promise<void>) | undefined;
  /**
   * Called when an entry is approved or someone is invited directly: send
   * the invite email here. Runs like `onJoin`. Errors are logged.
   */
  sendInvite?: ((invite: WaitlistInvite) => void | Promise<void>) | undefined;
  /** Called when an entry is rejected, with the entry as admins see it. Errors are logged. */
  onReject?: ((entry: WaitlistAdminEntry) => void | Promise<void>) | undefined;
}

export interface ResolvedWaitlistOptions {
  enabled: boolean;
  autoApprove: (email: string) => boolean | Promise<boolean>;
  requireInviteCode: boolean;
  /** In milliseconds; `0` = no expiry. */
  inviteExpiresIn: number;
  confirmEmail: boolean;
  sendConfirmationEmail: WaitlistOptions["sendConfirmationEmail"];
  /** In milliseconds. */
  confirmationExpiresIn: number;
  /** In milliseconds; `undefined` = kept. */
  retention: { rejected: number | undefined; registered: number | undefined };
  /** In milliseconds. */
  sweepInterval: number;
  /** Lowercased exact addresses. */
  allowEmails: Set<string>;
  /** Lowercased domains, matched with their subdomains. */
  allowDomains: string[];
  bypass: (context: GenericEndpointContext | null) => boolean;
  maxEntries: number | undefined;
  adminRoles: readonly string[];
  adminUserIds: readonly string[];
  onJoin: WaitlistOptions["onJoin"];
  sendInvite: WaitlistOptions["sendInvite"];
  onReject: WaitlistOptions["onReject"];
}
