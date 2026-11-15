import { getTestInstance } from "better-auth/test";
import { describe, expect, it } from "vitest";
import { NEVER_BLOCK } from "../scripts/never-block.ts";
import { blocklist } from "../src/index";
import { disposableEmailDomains, reservedUsernames } from "../src/lists/index";

describe.each([
  ["disposableEmailDomains", disposableEmailDomains],
  ["reservedUsernames", reservedUsernames],
])("%s", (_, list) => {
  it("is sorted and unique: every entry is greater than the one before", () => {
    const outOfOrder = list.filter((entry, i) => i > 0 && !((list[i - 1] ?? "") < entry));
    expect(outOfOrder).toEqual([]);
    expect(new Set(list).size).toBe(list.length);
  });

  it("is non-empty, lowercase, trimmed, and frozen", () => {
    expect(list.length).toBeGreaterThan(100);
    expect(list.filter((entry) => entry !== entry.toLowerCase().trim())).toEqual([]);
    expect(Object.isFrozen(list)).toBe(true);
  });
});

describe("disposableEmailDomains", () => {
  it("contains well-known disposable providers", () => {
    expect(disposableEmailDomains).toContain("mailinator.com");
    expect(disposableEmailDomains).toContain("guerrillamail.com");
  });

  it("contains only valid domain names", () => {
    const domain = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
    expect(disposableEmailDomains.filter((d) => !domain.test(d))).toEqual([]);
  });

  it("does not contain public suffixes, which would block every domain under them", () => {
    const suffixes = ["com", "co.uk", "net.ua", "zp.ua", "nom.za", "msk.ru", "it.com", "pp.ua"];
    expect(suffixes.filter((s) => disposableEmailDomains.includes(s))).toEqual([]);
  });

  it("does not contain any NEVER_BLOCK provider", () => {
    const set = new Set(disposableEmailDomains);
    expect(NEVER_BLOCK.filter((d) => set.has(d))).toEqual([]);
  });
});

describe("reservedUsernames", () => {
  it("contains typical reserved names", () => {
    for (const name of ["admin", "api", "root", "support", "settings"]) {
      expect(reservedUsernames).toContain(name);
    }
  });
});

describe("blocklist with the predefined lists", () => {
  it("blocks disposable domains and their subdomains, and allows the rest", async () => {
    const { auth } = await getTestInstance(
      { plugins: [blocklist({ email: { domains: disposableEmailDomains } })] },
      { disableTestUser: true },
    );
    const signUp = (email: string) =>
      auth.api.signUpEmail({ body: { email, password: "password1234", name: "Test" } });

    await expect(signUp("a@mailinator.com")).rejects.toMatchObject({
      body: { code: "EMAIL_NOT_ALLOWED" },
    });
    await expect(signUp("a@sub.mailinator.com")).rejects.toMatchObject({
      body: { code: "EMAIL_NOT_ALLOWED" },
    });
    await expect(signUp("a@gmail.com")).resolves.toBeTruthy();
  });

  it("accepts the lists for usernames and organizations", () => {
    expect(() =>
      blocklist({
        username: { values: reservedUsernames },
        organization: { values: reservedUsernames },
      }),
    ).not.toThrow();
  });
});
