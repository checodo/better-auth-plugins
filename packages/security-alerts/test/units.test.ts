import { describe, expect, it } from "vitest";
import { maskEmail } from "../src/hooks/database";
import { resolveOptions } from "../src/options";
import {
  coarseNetwork,
  describeDevice,
  deviceFromHeaders,
  parseUserAgent,
} from "../src/utils/device";

const sendAlert = () => {};

const UA = {
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.80",
  firefoxLinux: "Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.111 Mobile/15E148 Safari/604.1",
  samsungAndroid:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
  operaChromeOs:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0",
};

describe("parseUserAgent", () => {
  it("knows the common browsers and systems", () => {
    expect(parseUserAgent(UA.chromeMac)).toEqual({ browser: "Chrome", os: "macOS" });
    expect(parseUserAgent(UA.edgeWindows)).toEqual({ browser: "Edge", os: "Windows" });
    expect(parseUserAgent(UA.firefoxLinux)).toEqual({ browser: "Firefox", os: "Linux" });
    expect(parseUserAgent(UA.safariIphone)).toEqual({ browser: "Safari", os: "iOS" });
    expect(
      parseUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      ),
    ).toEqual({ browser: "Safari", os: "macOS" });
    expect(parseUserAgent(UA.chromeIphone)).toEqual({ browser: "Chrome", os: "iOS" });
    expect(parseUserAgent(UA.samsungAndroid)).toEqual({
      browser: "Samsung Internet",
      os: "Android",
    });
    expect(parseUserAgent(UA.operaChromeOs)).toEqual({ browser: "Opera", os: "ChromeOS" });
  });

  it("returns null for what it doesn't know", () => {
    expect(parseUserAgent("curl/8.7.1")).toEqual({ browser: null, os: null });
    expect(parseUserAgent(null)).toEqual({ browser: null, os: null });
  });

  it("ignores versions, so updates aren't new devices", () => {
    const older = UA.chromeMac.replace("124.0.0.0", "120.0.0.0");
    expect(parseUserAgent(older)).toEqual(parseUserAgent(UA.chromeMac));
  });
});

describe("deviceFromHeaders", () => {
  it("prefers User-Agent Client Hints", () => {
    const headers = new Headers({
      "user-agent": UA.chromeMac,
      "sec-ch-ua": '"Chromium";v="124", "Brave";v="124", "Not-A.Brand";v="99"',
      "sec-ch-ua-platform": '"Windows"',
    });
    expect(deviceFromHeaders(headers)).toEqual({ browser: "Brave", os: "Windows" });
  });

  it("takes Chromium for Chrome when no other brand is known", () => {
    const headers = new Headers({ "sec-ch-ua": '"Chromium";v="124", "Not-A.Brand";v="99"' });
    expect(deviceFromHeaders(headers).browser).toBe("Chrome");
  });

  it("falls back to the user agent", () => {
    expect(deviceFromHeaders(new Headers({ "user-agent": UA.firefoxLinux }))).toEqual({
      browser: "Firefox",
      os: "Linux",
    });
  });
});

describe("describeDevice", () => {
  it("labels the device for people", () => {
    expect(describeDevice({ browser: "Chrome", os: "macOS" }).label).toBe("Chrome on macOS");
    expect(describeDevice({ browser: null, os: "Linux" }).label).toBe("Unknown browser on Linux");
    expect(describeDevice({ browser: null, os: null }).label).toBe("Unknown browser");
  });
});

describe("coarseNetwork", () => {
  it("returns the /24 or /48 range", () => {
    expect(coarseNetwork("203.0.113.77")).toBe("203.0.113.0/24");
    expect(coarseNetwork("::ffff:203.0.113.77")).toBe("203.0.113.0/24");
    expect(coarseNetwork("2001:db8:abcd:12::1")).toBe("2001:db8:abcd::/48");
    expect(coarseNetwork("not an ip")).toBeNull();
    expect(coarseNetwork(null)).toBeNull();
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and the domain", () => {
    expect(maskEmail("john@example.com")).toBe("j***@example.com");
    expect(maskEmail("nope")).toBe("***");
  });
});

describe("options", () => {
  it("turns every alert on by default", () => {
    const resolved = resolveOptions({ sendAlert });
    expect(Object.values(resolved.alerts).every(Boolean)).toBe(true);
    expect(resolved.secureAccount).toBeNull();
    expect(resolved.newDevice).toMatchObject({
      includeIp: false,
      expiresIn: 90 * 86_400_000,
      maxDevices: 20,
    });
    expect(resolved.adminActions).toEqual({ alert: true, showActor: true });
  });

  it("turns single alerts off", () => {
    const resolved = resolveOptions({ sendAlert, alerts: { "api-key-created": false } });
    expect(resolved.alerts["api-key-created"]).toBe(false);
    expect(resolved.alerts["new-device"]).toBe(true);
  });

  it("resolves the secure-account link", () => {
    const resolved = resolveOptions({
      sendAlert,
      secureAccount: { callbackURL: "/secure-account", resetPasswordURL: "/reset-password" },
    });
    expect(resolved.secureAccount).toEqual({
      callbackURL: "/secure-account",
      expiresIn: 7 * 86_400_000,
      password: "block",
      resetPasswordURL: "/reset-password",
      emailChange: "keep",
      onSecured: undefined,
    });
  });

  it("throws on invalid static configuration", () => {
    // @ts-expect-error: sendAlert is required
    expect(() => resolveOptions({})).toThrow(/\[security-alerts\] "sendAlert" is required/);
    expect(() =>
      // @ts-expect-error: unknown alert type
      resolveOptions({ sendAlert, alerts: { "sign-in": false } }),
    ).toThrow(/Unknown alert type "sign-in"/);
    expect(() => resolveOptions({ sendAlert, newDevice: { expiresIn: 0 } })).toThrow(
      /newDevice\.expiresIn/,
    );
    expect(() => resolveOptions({ sendAlert, newDevice: { maxDevices: 1.5 } })).toThrow(
      /newDevice\.maxDevices/,
    );
    expect(() => resolveOptions({ sendAlert, secureAccount: { callbackURL: " " } })).toThrow(
      /secureAccount\.callbackURL/,
    );
    expect(() =>
      resolveOptions({ sendAlert, secureAccount: { callbackURL: "/secure-account" } }),
    ).toThrow(/secureAccount\.resetPasswordURL" is required with password: "block"/);
    expect(() =>
      resolveOptions({
        sendAlert,
        // @ts-expect-error: unknown action
        secureAccount: { callbackURL: "/s", password: "lock" },
      }),
    ).toThrow(/secureAccount\.password/);
    expect(() =>
      resolveOptions({ sendAlert, secureAccount: { callbackURL: "/s", password: "none" } }),
    ).not.toThrow();
    expect(() =>
      resolveOptions({
        sendAlert,
        // @ts-expect-error: unknown action
        secureAccount: { callbackURL: "/s", password: "none", emailChange: "revert" },
      }),
    ).toThrow(/secureAccount\.emailChange/);
  });
});
