import { createHmac } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import type { TestHelpers } from "better-auth/plugins";
import {
  admin,
  emailOTP,
  organization,
  phoneNumber,
  testUtils,
  twoFactor,
} from "better-auth/plugins";
import { getTestInstance } from "better-auth/test";
import { describe, expect, it } from "vitest";
import type { AuditEvent } from "../src/index";
import { auditLog, memoryStorage } from "../src/index";

const PASSWORD = "password1234";

/**
 * The audit log with official plugins whose endpoints it records by path
 * or through the database hooks: organization, two-factor, email OTP, and
 * phone number.
 */
async function setup<const P extends BetterAuthPlugin[]>(plugins: P) {
  const storage = memoryStorage();
  const { auth } = await getTestInstance(
    { plugins: [...plugins, testUtils(), auditLog({ storage })] },
    { disableTestUser: true },
  );
  const context = await auth.$context;
  // The plugins are generic here, so TypeScript can't resolve what
  // testUtils adds; the tests themselves are fully typed.
  const { test } = context as unknown as { test: TestHelpers };
  const createUser = async (email: string, extra: Record<string, unknown> = {}) => {
    const user = await test.saveUser(test.createUser({ email, ...extra }));
    return { user, headers: await test.getAuthHeaders({ userId: user.id }) };
  };
  const events = (type: string): AuditEvent[] =>
    storage.events.filter((event) => event.type === type);
  return { auth, context, createUser, events, storage };
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) for a base32 secret, as authenticator apps compute it. */
function totp(base32: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}

describe("organization", () => {
  it("records organizations, invitations, members, and roles", async () => {
    const { auth, createUser, events } = await setup([
      organization({ sendInvitationEmail: async () => {} }),
    ]);
    const { user: owner, headers } = await createUser("owner@example.com");
    const { user: bob, headers: bobHeaders } = await createUser("bob@example.com");
    const { user: carol, headers: carolHeaders } = await createUser("carol@example.com");

    const org = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme" },
      headers,
    });
    const organizationId = org?.id as string;
    await auth.api.updateOrganization({
      body: { data: { name: "Acme Inc" }, organizationId },
      headers,
    });
    const invitation = await auth.api.createInvitation({
      body: { email: "Bob@Example.com", role: "member", organizationId },
      headers,
    });
    const { member } = await auth.api.acceptInvitation({
      body: { invitationId: invitation.id },
      headers: bobHeaders,
    });
    const rejected = await auth.api.createInvitation({
      body: { email: "carol@example.com", role: "member", organizationId },
      headers,
    });
    await auth.api.rejectInvitation({ body: { invitationId: rejected.id }, headers: carolHeaders });
    const canceled = await auth.api.createInvitation({
      body: { email: "dan@example.com", role: "member", organizationId },
      headers,
    });
    await auth.api.cancelInvitation({ body: { invitationId: canceled.id }, headers });
    await auth.api.updateMemberRole({
      body: { memberId: member?.id as string, role: "admin", organizationId },
      headers,
    });
    // Server-only, without a path: not recorded (see the docs).
    await auth.api.addMember({ body: { userId: carol.id, role: "member", organizationId } });
    await auth.api.leaveOrganization({ body: { organizationId }, headers: carolHeaders });
    await auth.api.removeMember({
      body: { memberIdOrEmail: member?.id as string, organizationId },
      headers,
    });
    await auth.api.deleteOrganization({ body: { organizationId }, headers });

    const inOrg = { organizationId, status: "success" };
    expect(events("organization.created")).toEqual([
      expect.objectContaining({
        ...inOrg,
        userId: owner.id,
        actorUserId: owner.id,
        severity: "low",
        metadata: { name: "Acme", slug: "acme" },
      }),
    ]);
    expect(events("organization.updated")[0]).toMatchObject({
      ...inOrg,
      metadata: { fields: ["name"] },
    });
    expect(events("organization.invitation-created")[0]).toMatchObject({
      ...inOrg,
      actorUserId: owner.id,
      metadata: { invitationId: invitation.id, email: "bob@example.com", role: "member" },
    });
    expect(events("organization.invitation-accepted")).toEqual([
      expect.objectContaining({
        ...inOrg,
        userId: bob.id,
        actorUserId: bob.id,
        metadata: { invitationId: invitation.id, memberId: member?.id, role: "member" },
      }),
    ]);
    expect(events("organization.invitation-rejected")[0]).toMatchObject({
      ...inOrg,
      userId: carol.id,
      metadata: { invitationId: rejected.id },
    });
    expect(events("organization.invitation-canceled")[0]).toMatchObject({
      ...inOrg,
      actorUserId: owner.id,
      metadata: { invitationId: canceled.id, email: "dan@example.com" },
    });
    expect(events("organization.member-role-changed")).toEqual([
      expect.objectContaining({
        ...inOrg,
        userId: bob.id,
        actorUserId: owner.id,
        severity: "high",
        metadata: { memberId: member?.id, role: "admin" },
      }),
    ]);
    expect(events("organization.member-left")[0]).toMatchObject({
      ...inOrg,
      userId: carol.id,
      actorUserId: carol.id,
    });
    expect(events("organization.member-removed")).toEqual([
      expect.objectContaining({
        ...inOrg,
        userId: bob.id,
        actorUserId: owner.id,
        metadata: { memberId: member?.id },
      }),
    ]);
    expect(events("organization.deleted")).toEqual([
      expect.objectContaining({ ...inOrg, actorUserId: owner.id, severity: "high" }),
    ]);
  });

  it("records a refused role change as a failure", async () => {
    const { auth, createUser, events } = await setup([organization()]);
    const { headers } = await createUser("owner@example.com");
    const { user: bob, headers: bobHeaders } = await createUser("bob@example.com");
    const org = await auth.api.createOrganization({
      body: { name: "Acme", slug: "acme" },
      headers,
    });
    const organizationId = org?.id as string;
    const member = await auth.api.addMember({
      body: { userId: bob.id, role: "member", organizationId },
    });
    const owner = org?.members[0];

    await expect(
      auth.api.updateMemberRole({
        body: { memberId: owner?.id as string, role: "member", organizationId },
        headers: bobHeaders,
      }),
    ).rejects.toThrow();

    expect(events("organization.member-role-changed")).toEqual([
      expect.objectContaining({
        status: "failure",
        actorUserId: bob.id,
        organizationId,
        errorCode: expect.any(String),
      }),
    ]);
    expect(member?.userId).toBe(bob.id);
  });
});

describe("two-factor", () => {
  it("records turning two-factor on (after the first code) and off", async () => {
    const { auth, events } = await setup([twoFactor()]);
    const signUp = await auth.api.signUpEmail({
      body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
      returnHeaders: true,
    });
    const cookie = signUp.headers.get("set-cookie")?.split(";")[0] ?? "";
    const headers = new Headers({ cookie });
    const userId = signUp.response.user.id;

    const enabled = await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers });
    const totpURI = "totpURI" in enabled ? enabled.totpURI : "";
    // Not on yet: only the first verified code turns it on.
    expect(events("two-factor-enabled")).toEqual([]);
    const secret = new URL(totpURI).searchParams.get("secret") ?? "";
    const verified = await auth.api.verifyTOTP({
      body: { code: totp(secret) },
      headers,
      returnHeaders: true,
    });
    // Turning it on replaces the session.
    const sessionHeaders = new Headers({
      cookie: verified.headers.get("set-cookie")?.split(";")[0] ?? "",
    });

    expect(events("two-factor-enabled")).toEqual([
      expect.objectContaining({ userId, actorUserId: userId, severity: "medium" }),
    ]);

    const signIn = await auth.api.signInEmail({
      body: { email: "ada@example.com", password: PASSWORD },
      returnHeaders: true,
    });
    // Signing in with a code again doesn't record it as turned on.
    const twoFactorCookie = signIn.headers.get("set-cookie") ?? "";
    await auth.api.verifyTOTP({
      body: { code: totp(secret) },
      headers: new Headers({
        cookie: twoFactorCookie
          .split(/,(?=\s*[^;,]+=)/)
          .map((part) => part.split(";")[0]?.trim())
          .join("; "),
      }),
    });
    expect(events("two-factor-enabled")).toHaveLength(1);

    await auth.api.disableTwoFactor({ body: { password: PASSWORD }, headers: sessionHeaders });
    expect(events("two-factor-disabled")).toEqual([
      expect.objectContaining({ userId, actorUserId: userId, severity: "high" }),
    ]);
  });

  it("compares with the updated user, not the admin who updates them", async () => {
    const { auth, createUser, events } = await setup([twoFactor(), admin()]);
    const { user: root, headers } = await createUser("root@example.com", { role: "admin" });
    const { user: ada } = await createUser("ada@example.com", { twoFactorEnabled: true });

    // The admin has no two-factor; Ada's is on, and the admin turns it off.
    await auth.api.adminUpdateUser({
      body: { userId: ada.id, data: { twoFactorEnabled: false } },
      headers,
    });
    // Writing the value Ada already has changes nothing.
    await auth.api.adminUpdateUser({
      body: { userId: ada.id, data: { twoFactorEnabled: false } },
      headers,
    });

    expect(events("two-factor-disabled")).toEqual([
      expect.objectContaining({ userId: ada.id, actorUserId: root.id }),
    ]);
    expect(events("two-factor-enabled")).toEqual([]);
  });

  it("records turning it on directly with skipVerificationOnEnable", async () => {
    const { auth, events } = await setup([twoFactor({ skipVerificationOnEnable: true })]);
    const signUp = await auth.api.signUpEmail({
      body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
      returnHeaders: true,
    });
    const headers = new Headers({ cookie: signUp.headers.get("set-cookie")?.split(";")[0] ?? "" });
    await auth.api.enableTwoFactor({ body: { password: PASSWORD }, headers });
    expect(events("two-factor-enabled")).toEqual([
      expect.objectContaining({ userId: signUp.response.user.id }),
    ]);
  });
});

describe("password resets with a one-time code", () => {
  it("records an email OTP password reset for the user it resets", async () => {
    const otps = new Map<string, string>();
    const { auth, createUser, events } = await setup([
      emailOTP({
        sendVerificationOTP: async ({ email, otp }) => {
          otps.set(email, otp);
        },
      }),
    ]);
    const { user } = await createUser("ada@example.com");
    await auth.api.requestPasswordResetEmailOTP({ body: { email: "ada@example.com" } });

    await expect(
      auth.api.resetPasswordEmailOTP({
        body: { email: "ada@example.com", otp: "000000", password: "new-password-1" },
      }),
    ).rejects.toThrow();
    await auth.api.resetPasswordEmailOTP({
      body: {
        email: "ada@example.com",
        otp: otps.get("ada@example.com") ?? "",
        password: "new-password-1",
      },
    });

    expect(events("password-reset")).toEqual([
      expect.objectContaining({ userId: user.id, actorUserId: user.id, status: "failure" }),
      expect.objectContaining({ userId: user.id, actorUserId: user.id, status: "success" }),
    ]);
  });

  it("records a phone number password reset for the user it resets", async () => {
    const otps = new Map<string, string>();
    const { auth, createUser, events } = await setup([
      phoneNumber({
        sendOTP: async ({ phoneNumber, code }) => {
          otps.set(phoneNumber, code);
        },
        sendPasswordResetOTP: async ({ phoneNumber, code }) => {
          otps.set(phoneNumber, code);
        },
      }),
    ]);
    const { user } = await createUser("ada@example.com", {
      phoneNumber: "+15555550100",
      phoneNumberVerified: true,
    });
    await auth.api.requestPasswordResetPhoneNumber({ body: { phoneNumber: "+15555550100" } });
    await auth.api.resetPasswordPhoneNumber({
      body: {
        phoneNumber: "+15555550100",
        otp: otps.get("+15555550100") ?? "",
        newPassword: "new-password-1",
      },
    });

    expect(events("password-reset")).toEqual([
      expect.objectContaining({ userId: user.id, actorUserId: user.id, status: "success" }),
    ]);
  });
});
