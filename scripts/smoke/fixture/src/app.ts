/**
 * A minimal app that uses every published package the way a user would:
 * only through the public entry points, with better-auth from npm. Run by
 * `scripts/smoke-consumer.mts` after installing the packed tarballs; never
 * run inside the workspace.
 */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { AUDIT_LOG_ERROR_CODES, auditLog } from "@checodo/better-auth-audit-log";
import { auditLogClient } from "@checodo/better-auth-audit-log/client";
import { consoleDestination, httpDestination } from "@checodo/better-auth-audit-log/destinations";
import { authentication } from "@checodo/better-auth-authentication";
import { authenticationClient } from "@checodo/better-auth-authentication/client";
import { BLOCKLIST_ERROR_CODES, blocklist } from "@checodo/better-auth-blocklist";
import { blocklistClient } from "@checodo/better-auth-blocklist/client";
import { disposableEmailDomains, reservedUsernames } from "@checodo/better-auth-blocklist/lists";
import { disposableEmailDomains as disposableOnly } from "@checodo/better-auth-blocklist/lists/disposable-email-domains";
import { reservedUsernames as reservedOnly } from "@checodo/better-auth-blocklist/lists/reserved-usernames";
import { REFERRAL_ERROR_CODES, referral } from "@checodo/better-auth-referral";
import { referralClient } from "@checodo/better-auth-referral/client";
import { WAITLIST_ERROR_CODES, waitlist } from "@checodo/better-auth-waitlist";
import { waitlistClient } from "@checodo/better-auth-waitlist/client";
import type { BetterAuthOptions } from "better-auth";
import { betterAuth } from "better-auth";
import { createAuthClient } from "better-auth/client";
import { getMigrations } from "better-auth/db/migration";

const baseURL = "http://localhost:3000";
/** Event types the audit log's custom destination got. */
const forwarded: string[] = [];

const options = {
  baseURL,
  secret: "smoke-test-secret-smoke-test-secret-0123456789",
  database: new DatabaseSync(":memory:"),
  emailAndPassword: { enabled: true },
  plugins: [
    blocklist({
      email: { domains: disposableEmailDomains },
      username: { values: reservedUsernames },
    }),
    waitlist({ allow: ["example.com"], confirmEmail: false }),
    referral(),
    authentication({ steam: {} }),
    auditLog({
      destinations: [
        {
          name: "smoke",
          send: (batch) => {
            forwarded.push(...batch.map((event) => event.type));
          },
        },
        consoleDestination({ events: ["none.*"] }),
        httpDestination({ url: "https://example.com", events: ["none.*"] }),
      ],
    }),
  ],
} satisfies BetterAuthOptions;

// Types: the client plugins must infer the server endpoints.
const client = createAuthClient({
  baseURL,
  plugins: [
    blocklistClient(),
    waitlistClient(),
    referralClient(),
    authenticationClient(),
    auditLogClient(),
  ],
});
const typed: Array<(...args: never[]) => unknown> = [
  client.blocklist.listRules,
  client.waitlist.join,
  client.referral.getCode,
  client.auditLog.listEvents,
];
assert.equal(typed.length, 4);

// Every subpath export loads.
assert.ok(disposableOnly.length > 1000, "disposable list is loaded");
assert.ok(reservedOnly.includes("admin"), "reserved usernames are loaded");
for (const codes of [
  AUDIT_LOG_ERROR_CODES,
  BLOCKLIST_ERROR_CODES,
  REFERRAL_ERROR_CODES,
  WAITLIST_ERROR_CODES,
]) {
  assert.ok(Object.keys(codes).length > 0, "error codes are exported");
}

const { runMigrations } = await getMigrations(options);
await runMigrations();
const auth = betterAuth(options);

async function call(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", baseURL);
  if (init.body) headers.set("content-type", "application/json");
  if (init.cookie) headers.set("cookie", init.cookie);
  return auth.handler(new Request(`${baseURL}/api/auth${path}`, { ...init, headers }));
}

// Sign-up runs the blocklist, waitlist, referral, and audit-log hooks.
const signUp = await call("/sign-up/email", {
  method: "POST",
  body: JSON.stringify({ email: "ada@example.com", password: "a-long-password-1", name: "Ada" }),
});
assert.equal(signUp.status, 200, `sign-up: ${await signUp.clone().text()}`);
const cookie = (signUp.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
assert.ok(cookie, "sign-up sets a session cookie");

// blocklist: a disposable domain is rejected.
const blocked = await call("/sign-up/email", {
  method: "POST",
  body: JSON.stringify({
    email: `ada@${disposableOnly[0]}`,
    password: "a-long-password-1",
    name: "Ada",
  }),
});
assert.equal(blocked.status, 400, "blocklist rejects a disposable domain");
assert.equal(((await blocked.json()) as { code?: string }).code, "EMAIL_NOT_ALLOWED");

// waitlist: an address outside the allow-list can't sign up directly.
const gated = await call("/sign-up/email", {
  method: "POST",
  body: JSON.stringify({ email: "bob@other.test", password: "a-long-password-1", name: "Bob" }),
});
assert.equal(gated.status, 403, "waitlist gates sign-up");
assert.equal(((await gated.json()) as { code?: string }).code, "EMAIL_NOT_APPROVED");

// referral: the signed-in user gets a code.
const code = await call("/referral/get-code", { cookie });
assert.equal(code.status, 200, `referral/get-code: ${await code.clone().text()}`);

// audit-log: the sign-up was recorded.
const events = await call("/audit-log/list-events", { cookie });
assert.equal(events.status, 200, `audit-log/list-events: ${await events.clone().text()}`);
const { events: list } = (await events.json()) as { events: Array<{ type: string }> };
assert.ok(list.length > 0, "audit-log recorded events");
await auth.api.flushAuditDestinations();
assert.ok(forwarded.includes("sign-up"), "audit-log sent events to its destination");
// audit-log: server code exports without a session; users can't over HTTP.
const exported = (await auth.api.exportAuditEvents({ query: { format: "csv" } })) as Response;
assert.ok((await exported.text()).startsWith("id,createdAt,type"), "audit-log exports CSV");
const notAdmin = await call("/audit-log/export", { cookie });
assert.equal(notAdmin.status, 403, `audit-log/export: ${await notAdmin.clone().text()}`);

// authentication: Steam builds its sign-in URL without network access.
const steam = await call("/sign-in/social", {
  method: "POST",
  body: JSON.stringify({ provider: "steam", callbackURL: "/" }),
});
assert.equal(steam.status, 200, `sign-in/social steam: ${await steam.clone().text()}`);
const { url } = (await steam.json()) as { url: string };
assert.ok(url.startsWith("https://steamcommunity.com/openid/login"), "Steam sign-in URL");

console.log("Smoke test passed: every package installs, type-checks, and runs.");
