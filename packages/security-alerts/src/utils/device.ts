import { canonicalCidr, formatIp, parseIp } from "@repo/plugin-utils/ip";
import type { SecurityAlertDevice } from "../types";

interface Family {
  name: string;
  test: RegExp;
}

/**
 * Browser families, most specific first: Edge, Opera, and Samsung Internet
 * also say "Chrome" and "Safari"; Chrome also says "Safari".
 */
const BROWSERS: Family[] = [
  { name: "Edge", test: /\b(?:Edg|EdgA|EdgiOS|Edge)\// },
  { name: "Opera", test: /\b(?:OPR|OPT|Opera)\// },
  { name: "Samsung Internet", test: /\bSamsungBrowser\// },
  { name: "Vivaldi", test: /\bVivaldi\// },
  { name: "Yandex", test: /\bYaBrowser\// },
  { name: "Firefox", test: /\b(?:Firefox|FxiOS)\// },
  { name: "Chrome", test: /\b(?:Chrome|CriOS|Chromium)\// },
  { name: "Safari", test: /\bVersion\/[\d.]+.*\bSafari\// },
];

/** Systems, most specific first: iOS and Android also mention "Mac OS X" and "Linux". */
const SYSTEMS: Family[] = [
  { name: "Windows", test: /\bWindows\b/ },
  { name: "iOS", test: /\b(?:iPhone|iPad|iPod)\b/ },
  { name: "Android", test: /\bAndroid\b/ },
  { name: "ChromeOS", test: /\bCrOS\b/ },
  { name: "macOS", test: /\b(?:Macintosh|Mac OS X)\b/ },
  { name: "Linux", test: /\bLinux\b/ },
];

/** Brands of User-Agent Client Hints (`Sec-CH-UA`) and the family they name. */
const HINT_BRANDS: Record<string, string> = {
  "google chrome": "Chrome",
  "microsoft edge": "Edge",
  opera: "Opera",
  "opera gx": "Opera",
  "samsung internet": "Samsung Internet",
  vivaldi: "Vivaldi",
  yandex: "Yandex",
  brave: "Brave",
};

/** Platforms of `Sec-CH-UA-Platform` and the family they name. */
const HINT_PLATFORMS: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  ios: "iOS",
  android: "Android",
  "chrome os": "ChromeOS",
  chromeos: "ChromeOS",
  linux: "Linux",
};

const MAX_HEADER_LENGTH = 1000;

const familyOf = (families: Family[], userAgent: string) =>
  families.find((family) => family.test.test(userAgent))?.name ?? null;

/** The brands in a `Sec-CH-UA` header: `"Chromium";v="124", "Google Chrome";v="124"`. */
function hintBrand(header: string | null): string | null {
  if (!header) return null;
  let chromium = false;
  for (const match of header.slice(0, MAX_HEADER_LENGTH).matchAll(/"([^"]*)"\s*;\s*v=/g)) {
    const brand = (match[1] ?? "").trim().toLowerCase();
    const family = HINT_BRANDS[brand];
    if (family) return family;
    if (brand === "chromium") chromium = true;
  }
  return chromium ? "Chrome" : null;
}

function hintPlatform(header: string | null): string | null {
  if (!header) return null;
  const platform = header.trim().replace(/^"|"$/g, "").toLowerCase();
  return HINT_PLATFORMS[platform] ?? null;
}

/**
 * The browser and OS family of a user agent string. Only families, no
 * versions, so a browser update isn't a new device.
 */
export function parseUserAgent(userAgent: string | null | undefined): {
  browser: string | null;
  os: string | null;
} {
  if (!userAgent) return { browser: null, os: null };
  const value = userAgent.slice(0, MAX_HEADER_LENGTH);
  return { browser: familyOf(BROWSERS, value), os: familyOf(SYSTEMS, value) };
}

/**
 * The default `newDevice.getDevice`: User-Agent Client Hints when the
 * browser sends them (Chromium-based browsers), else the user agent.
 */
export function deviceFromHeaders(headers: Headers): { browser: string | null; os: string | null } {
  const parsed = parseUserAgent(headers.get("user-agent"));
  return {
    browser: hintBrand(headers.get("sec-ch-ua")) ?? parsed.browser,
    os: hintPlatform(headers.get("sec-ch-ua-platform")) ?? parsed.os,
  };
}

/** Adds the label people read: "Chrome on macOS". */
export function describeDevice(device: {
  browser: string | null;
  os: string | null;
}): SecurityAlertDevice {
  const browser = device.browser ?? "Unknown browser";
  const label = device.os ? `${browser} on ${device.os}` : browser;
  return { browser: device.browser, os: device.os, label };
}

/** The /24 (IPv4) or /48 (IPv6) range of an address, or `null` if it isn't one. */
export function coarseNetwork(ipAddress: string | null | undefined): string | null {
  if (!ipAddress) return null;
  const bytes = parseIp(ipAddress);
  if (!bytes) return null;
  // `parseIp` turns IPv4-mapped IPv6 addresses into the IPv4 address.
  const prefix = bytes.length === 4 ? 24 : 48;
  return canonicalCidr(`${formatIp(bytes)}/${prefix}`);
}
