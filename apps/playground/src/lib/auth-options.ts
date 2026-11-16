import { DatabaseSync } from "node:sqlite";
import { auditLog } from "@checodo/better-auth-audit-log";
import { authentication } from "@checodo/better-auth-authentication";
import { blocklist } from "@checodo/better-auth-blocklist";
import { disposableEmailDomains, reservedUsernames } from "@checodo/better-auth-blocklist/lists";
import { referral } from "@checodo/better-auth-referral";
import { waitlist } from "@checodo/better-auth-waitlist";
import type { BetterAuthOptions } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { admin, organization, username } from "better-auth/plugins";

/**
 * The playground's auth config: a local SQLite file (Node's built-in
 * `node:sqlite`, no native driver) and the plugins of this repository next
 * to the official plugins they work with.
 *
 * Kept apart from the instance (`./auth.ts`) so `src/instrumentation.ts`
 * can create the tables from it before any instance exists. Creating an
 * instance first would run better-auth's schema check against an empty
 * database.
 */
const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3001";

export const authOptions = {
  appName: "better-auth-plugins playground",
  baseURL,
  // Development only: a fixed secret so sessions survive restarts.
  secret: process.env.BETTER_AUTH_SECRET || "playground-secret-for-local-development-only",
  database: new DatabaseSync("playground.db"),
  emailAndPassword: { enabled: true },
  user: {
    changeEmail: { enabled: true, updateEmailWithoutVerification: true },
  },
  // Steam, Epic Games, and Xbox share no email, so linking them needs these (see the
  // authentication plugin docs, "Link an account").
  account: {
    accountLinking: {
      trustedProviders: ["steam", "epic", "xbox"],
      allowDifferentEmails: true,
    },
  },
  plugins: [
    blocklist({
      email: {
        domains: disposableEmailDomains,
        addresses: ["blocked@acme.test"],
      },
      username: { values: reservedUsernames },
      organization: { values: reservedUsernames },
      team: { values: [{ value: "staff", type: "contains" }] },
      // Passwords with the email, username, or app name are blocked too.
      password: { values: ["password123", { value: "qwerty", type: "contains" }] },
      // A documentation range (RFC 5737), so localhost keeps working. Send
      // `x-forwarded-for: 203.0.113.7` to try it, or add a rule on the Admin page.
      ip: { ranges: ["203.0.113.0/24"] },
      onBlocked: ({ target, value, rule }) => {
        console.info(
          `[blocklist] blocked ${target} "${value}" by ${rule.type} rule "${rule.value}"`,
        );
      },
    }),
    waitlist({
      // acme.test addresses skip the waitlist, so the other demos keep
      // working; every other address has to be approved first.
      allow: ["acme.test", "steam.invalid", "epic.invalid", "xbox.invalid"],
      // The playground logs the emails it would send. The links open the
      // Waitlist page, which calls the plugin with the token or code.
      sendConfirmationEmail: ({ email, token }) => {
        console.info(`[waitlist] confirm ${email}: ${baseURL}/waitlist?confirm=${token}`);
      },
      onJoin: ({ email }) => {
        console.info(`[waitlist] ${email} joined`);
      },
      sendInvite: ({ email, inviteCode, token }) => {
        console.info(
          `[waitlist] invite for ${email}: ${baseURL}/waitlist?invite=${inviteCode}&token=${token}`,
        );
      },
    }),
    referral({
      // The Referral page has a button that records "first-purchase".
      steps: ["first-purchase"],
      onReferral: ({ referrerUserId, referredUserId }) => {
        console.info(`[referral] ${referrerUserId} referred ${referredUserId}`);
      },
      onReferralCompleted: ({ referrerUserId }) => {
        console.info(`[referral] completed: reward ${referrerUserId}`);
      },
    }),
    // Steam works without credentials (the API key only adds names and
    // avatars). Epic and Xbox need their own, see .env.example.
    authentication({
      steam: { apiKey: process.env.STEAM_API_KEY || undefined },
      ...(process.env.EPIC_CLIENT_ID && process.env.EPIC_CLIENT_SECRET
        ? {
            epic: {
              clientId: process.env.EPIC_CLIENT_ID,
              clientSecret: process.env.EPIC_CLIENT_SECRET,
            },
          }
        : {}),
      ...(process.env.XBOX_CLIENT_ID && process.env.XBOX_CLIENT_SECRET
        ? {
            xbox: {
              clientId: process.env.XBOX_CLIENT_ID,
              clientSecret: process.env.XBOX_CLIENT_SECRET,
            },
          }
        : {}),
    }),
    username(),
    admin(),
    organization({ teams: { enabled: true } }),
    // After the other plugins, so it sees finished sign-ins; only
    // nextCookies() goes later.
    auditLog({
      retention: { days: 30 },
      onEvent: ({ type, status, userId }) => {
        console.info(`[audit-log] ${type} ${status}${userId ? ` for ${userId}` : ""}`);
      },
    }),
    nextCookies(),
  ],
} satisfies BetterAuthOptions;
