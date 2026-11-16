import { describe, expect, it } from "vitest";
import {
  canonicalCidr,
  canonicalIp,
  formatIp,
  isInNetwork,
  parseCidr,
  parseIp,
} from "../src/utils/ip";

describe("parseIp / canonicalIp", () => {
  it("parses IPv4", () => {
    expect(canonicalIp("203.0.113.7")).toBe("203.0.113.7");
    expect(canonicalIp(" 0.0.0.0 ")).toBe("0.0.0.0");
  });

  it("rejects malformed IPv4", () => {
    for (const value of [
      "256.0.0.1",
      "1.2.3",
      "1.2.3.4.5",
      "01.2.3.4",
      "1.2.3.-4",
      "a.b.c.d",
      "",
    ]) {
      expect(parseIp(value), value).toBeNull();
    }
  });

  it("writes IPv6 in RFC 5952 form", () => {
    expect(canonicalIp("2001:0DB8:0000:0000:0000:0000:0000:0001")).toBe("2001:db8::1");
    expect(canonicalIp("2001:db8:0:0:1:0:0:1")).toBe("2001:db8::1:0:0:1");
    expect(canonicalIp("2001:db8:0:1:1:1:1:1")).toBe("2001:db8:0:1:1:1:1:1");
    expect(canonicalIp("::")).toBe("::");
    expect(canonicalIp("::1")).toBe("::1");
    expect(canonicalIp("fe80::")).toBe("fe80::");
  });

  it("turns IPv4-mapped IPv6 addresses into IPv4", () => {
    expect(canonicalIp("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(canonicalIp("::FFFF:c000:0201")).toBe("192.0.2.1");
    expect(parseIp("::ffff:192.0.2.1")).toHaveLength(4);
  });

  it("rejects malformed IPv6 and zone ids", () => {
    for (const value of [
      "1::2::3",
      "12345::",
      "1:2:3:4:5:6:7:8:9",
      "1:2:3:4:5:6:7",
      "fe80::1%eth0",
      "::g",
    ]) {
      expect(parseIp(value), value).toBeNull();
    }
  });

  it("accepts an embedded IPv4 address only at the end of the address", () => {
    for (const value of [
      "192.0.2.1::",
      "1:2:192.0.2.1::",
      "1:192.0.2.1::5",
      "::192.0.2.1:1",
      "1:2:3:4:5:192.0.2.1:7",
      "1:2:3:4:5:6:7:192.0.2.1",
      "::1.2.3",
    ]) {
      expect(parseIp(value), value).toBeNull();
    }
    expect(canonicalIp("::192.0.2.1")).toBe("::c000:201");
    expect(canonicalIp("1:2:3:4:5:6:192.0.2.1")).toBe("1:2:3:4:5:6:c000:201");
    expect(canonicalIp("64:ff9b::192.0.2.1")).toBe("64:ff9b::c000:201");
    expect(canonicalIp("::ffff:192.0.2.1")).toBe("192.0.2.1");
  });

  it("round-trips through formatIp", () => {
    const bytes = parseIp("2001:db8::abcd") as Uint8Array;
    expect(formatIp(bytes)).toBe("2001:db8::abcd");
  });
});

describe("parseCidr", () => {
  it("clears host bits", () => {
    expect(canonicalCidr("10.1.2.3/8")).toBe("10.0.0.0/8");
    expect(canonicalCidr("203.0.113.77/25")).toBe("203.0.113.0/25");
    expect(canonicalCidr("2001:db8:abcd::1/32")).toBe("2001:db8::/32");
    expect(canonicalCidr("0.0.0.0/0")).toBe("0.0.0.0/0");
  });

  it("turns an IPv4-mapped range into the IPv4 range", () => {
    expect(canonicalCidr("::ffff:10.0.0.0/104")).toBe("10.0.0.0/8");
    expect(parseCidr("::ffff:10.0.0.0/64")).toBeNull();
  });

  it("rejects bare addresses, bad prefixes, and bad addresses", () => {
    for (const value of [
      "10.0.0.0",
      "10.0.0.0/33",
      "2001:db8::/129",
      "10.0.0.0/-1",
      "10.0.0.0/a",
      "x/8",
    ]) {
      expect(parseCidr(value), value).toBeNull();
    }
  });
});

describe("isInNetwork", () => {
  const contains = (range: string, ip: string) =>
    isInNetwork(
      parseIp(ip) as Uint8Array,
      parseCidr(range) as NonNullable<ReturnType<typeof parseCidr>>,
    );

  it("matches addresses inside the range only", () => {
    expect(contains("203.0.113.0/24", "203.0.113.255")).toBe(true);
    expect(contains("203.0.113.0/24", "203.0.114.0")).toBe(false);
    expect(contains("10.0.0.0/9", "10.127.255.255")).toBe(true);
    expect(contains("10.0.0.0/9", "10.128.0.0")).toBe(false);
    expect(contains("0.0.0.0/0", "8.8.8.8")).toBe(true);
    expect(contains("2001:db8::/32", "2001:db8:ffff::1")).toBe(true);
    expect(contains("2001:db8::/32", "2001:db9::1")).toBe(false);
  });

  it("never matches across address families, except IPv4-mapped addresses", () => {
    expect(contains("::/0", "8.8.8.8")).toBe(false);
    expect(contains("0.0.0.0/0", "2001:db8::1")).toBe(false);
    expect(contains("192.0.2.0/24", "::ffff:192.0.2.1")).toBe(true);
  });
});
