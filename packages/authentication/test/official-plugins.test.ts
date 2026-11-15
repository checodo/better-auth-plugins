import { waitlist } from "@checodo/better-auth-waitlist";
import { lastLoginMethod, multiSession } from "better-auth/plugins";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_KEY, STEAM_ID, setup, steamAssertion, stubSteam } from "./helpers";

afterEach(() => vi.restoreAllMocks());

/**
 * Steam sign-in (the provider without credentials, so the easiest to drive)
 * with official plugins that react to sign-ins, and with the waitlist,
 * which gates the placeholder emails.
 */
async function signInWithSteam(instance: Awaited<ReturnType<typeof setup>>) {
  const { url, cookie } = await instance.start("steam");
  const returnTo = url.searchParams.get("openid.return_to") as string;
  return instance.callback(steamAssertion(returnTo), cookie);
}

describe("last login method", () => {
  it("records steam as the last login method, in a cookie and on the user", async () => {
    stubSteam();
    const instance = await setup(
      { steam: { apiKey: API_KEY } },
      { plugins: [lastLoginMethod({ storeInDatabase: true })] },
    );
    const { response } = await signInWithSteam(instance);

    expect(response.headers.getSetCookie().join()).toMatch(/last_used_login_method=steam/);
    const [account] = await instance.accounts("steam");
    const user = await instance.context.adapter.findOne<{ lastLoginMethod?: string }>({
      model: "user",
      where: [{ field: "id", value: account?.userId ?? "" }],
    });
    expect(user?.lastLoginMethod).toBe("steam");
  });
});

describe("multi session", () => {
  it("adds the Steam session to the device's sessions", async () => {
    stubSteam();
    const instance = await setup({ steam: { apiKey: API_KEY } }, { plugins: [multiSession()] });
    const { response } = await signInWithSteam(instance);

    expect(response.headers.getSetCookie().join()).toMatch(/_multi-/);
  });
});

describe("waitlist", () => {
  it("gates Steam sign-ups unless `allow` has the placeholder domain", async () => {
    stubSteam();
    const gated = await setup(
      { steam: { apiKey: API_KEY } },
      { plugins: [waitlist({ confirmEmail: false })] },
    );
    const refused = await signInWithSteam(gated);
    expect(refused.location).toContain("error=");
    expect(await gated.accounts("steam")).toEqual([]);

    const allowed = await setup(
      { steam: { apiKey: API_KEY } },
      { plugins: [waitlist({ confirmEmail: false, allow: ["steam.invalid"] })] },
    );
    const { location } = await signInWithSteam(allowed);
    expect(location).toBe("/dashboard");
    expect(await allowed.accounts("steam")).toEqual([
      expect.objectContaining({ accountId: STEAM_ID }),
    ]);
  });
});
