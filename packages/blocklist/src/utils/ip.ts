/**
 * IP address and CIDR range parsing for the `ip` target. Written here, not
 * imported from `node:net`, so the plugin keeps working on edge runtimes.
 * IPv4-mapped IPv6 addresses (`::ffff:192.0.2.1`) are treated as the IPv4
 * address they carry, like better-auth's own IP handling.
 */

/** A parsed CIDR range: the network address (host bits cleared) and its prefix length. */
export interface IpNetwork {
  bytes: Uint8Array;
  prefix: number;
}

const IPV4_PART = /^(0|[1-9]\d{0,2})$/;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/i;

function parseIpv4(value: string): Uint8Array | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const part = parts[i] as string;
    if (!IPV4_PART.test(part)) return null;
    const number = Number(part);
    if (number > 255) return null;
    bytes[i] = number;
  }
  return bytes;
}

function parseGroups(side: string): number[] | null {
  if (side === "") return [];
  const groups: number[] = [];
  const parts = side.split(":");
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string;
    // An embedded IPv4 address may end the address: ::ffff:192.0.2.1
    if (i === parts.length - 1 && part.includes(".")) {
      const ipv4 = parseIpv4(part);
      if (!ipv4) return null;
      groups.push(((ipv4[0] as number) << 8) | (ipv4[1] as number));
      groups.push(((ipv4[2] as number) << 8) | (ipv4[3] as number));
    } else {
      if (!IPV6_GROUP.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
  }
  return groups;
}

function parseIpv6(value: string): Uint8Array | null {
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = parseGroups(halves[0] as string);
  const right = halves.length === 2 ? parseGroups(halves[1] as string) : [];
  if (!left || !right) return null;

  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...new Array<number>(missing).fill(0), ...right];
  } else {
    groups = left;
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  groups.forEach((group, i) => {
    bytes[i * 2] = group >> 8;
    bytes[i * 2 + 1] = group & 0xff;
  });
  return bytes;
}

/** Whether 16 bytes are an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`). */
function isMappedIpv4(bytes: Uint8Array): boolean {
  if (bytes.length !== 16) return false;
  for (let i = 0; i < 10; i++) if (bytes[i] !== 0) return false;
  return bytes[10] === 0xff && bytes[11] === 0xff;
}

/**
 * Parses an IPv4 or IPv6 address into its bytes (4 or 16). IPv4-mapped
 * IPv6 addresses become 4 bytes. Returns `null` for anything else,
 * including zone ids (`fe80::1%eth0`) and IPv4 parts with leading zeros.
 */
export function parseIp(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (trimmed.includes(":")) {
    const bytes = parseIpv6(trimmed);
    if (bytes && isMappedIpv4(bytes)) return bytes.slice(12);
    return bytes;
  }
  return parseIpv4(trimmed);
}

/**
 * Writes an address in its canonical text form: dotted IPv4, or IPv6 as in
 * RFC 5952 (lowercase, no leading zeros, the longest run of two or more
 * zero groups written as `::`).
 */
export function formatIp(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join(".");

  const groups: number[] = [];
  for (let i = 0; i < 16; i += 2)
    groups.push(((bytes[i] as number) << 8) | (bytes[i + 1] as number));

  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i += 1;
      continue;
    }
    let end = i;
    while (end < 8 && groups[end] === 0) end += 1;
    if (end - i > bestLength) {
      bestStart = i;
      bestLength = end - i;
    }
    i = end;
  }

  const hex = groups.map((group) => group.toString(16));
  if (bestLength < 2) return hex.join(":");
  const head = hex.slice(0, bestStart).join(":");
  const tail = hex.slice(bestStart + bestLength).join(":");
  return `${head}::${tail}`;
}

/** The canonical form of an address, or `null` if it isn't one. */
export function canonicalIp(value: string): string | null {
  const bytes = parseIp(value);
  return bytes ? formatIp(bytes) : null;
}

/**
 * Parses a CIDR range such as `203.0.113.0/24` or `2001:db8::/32`. Host
 * bits are cleared, so `10.1.2.3/8` is the range `10.0.0.0/8`. A range of
 * IPv4-mapped IPv6 addresses (`::ffff:10.0.0.0/104`) becomes the IPv4
 * range. Returns `null` for anything else, including a bare address.
 */
export function parseCidr(value: string): IpNetwork | null {
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  if (slash === -1) return null;
  const prefixText = trimmed.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixText)) return null;
  let prefix = Number(prefixText);

  const address = trimmed.slice(0, slash);
  let bytes: Uint8Array | null;
  if (address.includes(":")) {
    bytes = parseIpv6(address);
    if (bytes && isMappedIpv4(bytes)) {
      if (prefix < 96) return null;
      bytes = bytes.slice(12);
      prefix -= 96;
    }
  } else {
    bytes = parseIpv4(address);
  }
  if (!bytes || prefix > bytes.length * 8) return null;

  const network = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const bits = Math.min(8, Math.max(0, prefix - i * 8));
    const mask = bits === 0 ? 0 : (0xff << (8 - bits)) & 0xff;
    network[i] = (bytes[i] as number) & mask;
  }
  return { bytes: network, prefix };
}

/** The canonical form of a CIDR range (`network/prefix`), or `null` if it isn't one. */
export function canonicalCidr(value: string): string | null {
  const network = parseCidr(value);
  return network ? `${formatIp(network.bytes)}/${network.prefix}` : null;
}

/** Whether the address `bytes` lies inside `network`. IPv4 never matches an IPv6 range. */
export function isInNetwork(bytes: Uint8Array, network: IpNetwork): boolean {
  if (bytes.length !== network.bytes.length) return false;
  let remaining = network.prefix;
  for (let i = 0; i < bytes.length && remaining > 0; i++) {
    const bits = Math.min(8, remaining);
    const mask = (0xff << (8 - bits)) & 0xff;
    if (((bytes[i] as number) & mask) !== (network.bytes[i] as number)) return false;
    remaining -= bits;
  }
  return true;
}
