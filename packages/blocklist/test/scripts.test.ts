import { describe, expect, it } from "vitest";
import type { DnsResolver } from "../scripts/mail-dns.ts";
import { checkDomain } from "../scripts/mail-dns.ts";
import {
  DOMAIN,
  lines,
  mailServiceHosts,
  mergeEntries,
  parsePublicSuffixList,
} from "../scripts/sources.ts";

describe("source parsers", () => {
  it("lines skips blank lines and # comments", () => {
    expect(lines("# header\n a.com \n\nb.com\n")).toEqual(["a.com", "b.com"]);
  });

  it("mailServiceHosts returns every provider and its hosts", () => {
    const json = JSON.stringify({ "gmx.net": { hosts: ["gmx.de", "gmx.at"] }, "web.de": {} });
    expect(mailServiceHosts(json)).toEqual(["gmx.net", "gmx.de", "gmx.at", "web.de"]);
  });

  it("parsePublicSuffixList handles comments, wildcards, exceptions, and IDNs", () => {
    const psl = "// ICANN\ncom\n*.ck\n!www.ck\n// private\nmsk.ru\nрф\n";
    expect(parsePublicSuffixList(psl)).toEqual(["com", "ck", "www.ck", "msk.ru", "xn--p1ai"]);
  });
});

describe("mergeEntries", () => {
  it("drops invalid, excluded, and public-suffix entries, then de-duplicates and sorts", () => {
    const result = mergeEntries(
      [
        ["B.com", "a.com", "not a domain"],
        ["a.com", "net.ua", "gmail.com"],
      ],
      {
        valid: DOMAIN,
        excluded: new Set(["gmail.com"]),
        publicSuffixes: new Set(["net.ua"]),
      },
    );
    expect(result).toEqual({
      entries: ["a.com", "b.com"],
      invalid: 1,
      removed: 1,
      suffixesRemoved: ["net.ua"],
    });
  });
});

/** A fake DNS server: answers from `records`, errors from `errors`. */
function fakeResolver(
  records: Record<string, { mx?: string[]; a?: string[] }>,
  errors: Record<string, string> = {},
): DnsResolver {
  const answer = async <T>(domain: string, value: T[] | undefined): Promise<T[]> => {
    const code =
      errors[domain] ?? (domain in records ? (value?.length ? undefined : "ENODATA") : "ENOTFOUND");
    if (code) throw Object.assign(new Error(code), { code });
    return value ?? [];
  };
  return {
    resolveMx: (domain: string) =>
      answer(
        domain,
        records[domain]?.mx?.map((exchange) => ({ exchange, priority: 10 })),
      ),
    resolve4: (domain: string) => answer(domain, records[domain]?.a),
    resolve6: (domain: string) => answer(domain, undefined),
  } as unknown as DnsResolver;
}

describe("checkDomain", () => {
  const resolver = fakeResolver(
    {
      "mx.example": { mx: ["mail.mx.example"] },
      "a-only.example": { a: ["192.0.2.1"] },
      "null-mx.example": { mx: [""] },
      "empty.example": {},
    },
    { "flaky.example": "ETIMEOUT" },
  );

  it.each([
    ["mx.example", "mail"],
    ["a-only.example", "mail"],
    ["null-mx.example", "dead"],
    ["empty.example", "dead"],
    ["missing.example", "dead"],
    ["flaky.example", "unknown"],
  ] as const)("classifies %s as %s", async (domain, status) => {
    expect(await checkDomain(resolver, domain, 0)).toBe(status);
  });
});
