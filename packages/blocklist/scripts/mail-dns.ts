/**
 * Checks whether domains can receive email, for `update-lists.ts`.
 *
 * - `mail`: the domain has MX records, or no MX records but an A/AAAA
 *   record (mail then goes to that host, RFC 5321 section 5.1).
 * - `dead`: the domain doesn't exist (NXDOMAIN), publishes a "null MX"
 *   that refuses all mail (RFC 7505), or has neither MX nor A/AAAA records.
 * - `unknown`: the lookup failed (timeout, server failure) even after a
 *   retry.
 *
 * Queries go to public resolvers (`DNS_SERVERS`), not the system resolver:
 * local filters such as Pi-hole, NextDNS, or company DNS often answer
 * "no such domain" for disposable providers, which would wrongly remove
 * them. Set the `DNS_SERVERS` environment variable (comma-separated) to
 * use other servers.
 */
import { Resolver } from "node:dns/promises";

export type MailStatus = "mail" | "dead" | "unknown";

/** The DNS queries used; a `Resolver`, or a fake in tests. */
export type DnsResolver = Pick<Resolver, "resolveMx" | "resolve4" | "resolve6">;

/** Cloudflare and Google public DNS. */
export const DNS_SERVERS = process.env.DNS_SERVERS?.split(",").map((s) => s.trim()) ?? [
  "1.1.1.1",
  "8.8.8.8",
  "1.0.0.1",
  "8.8.4.4",
];

/** "No such name" and "no records of this type", the two answers that are final. */
const isNotFound = (error: unknown) =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ENOTFOUND" || error.code === "ENODATA");

const isNoData = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENODATA";

async function hasAddress(resolver: DnsResolver, domain: string): Promise<boolean> {
  for (const lookup of [() => resolver.resolve4(domain), () => resolver.resolve6(domain)]) {
    try {
      if ((await lookup()).length > 0) return true;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  return false;
}

async function checkOnce(resolver: DnsResolver, domain: string): Promise<MailStatus> {
  try {
    const records = await resolver.resolveMx(domain);
    if (records.length === 0) return (await hasAddress(resolver, domain)) ? "mail" : "dead";
    const nullMx = records.every((r) => r.exchange === "" || r.exchange === ".");
    return nullMx ? "dead" : "mail";
  } catch (error) {
    if (isNoData(error)) return (await hasAddress(resolver, domain)) ? "mail" : "dead";
    if (isNotFound(error)) return "dead";
    throw error;
  }
}

/** Classifies one domain, retrying once after a failed lookup. */
export async function checkDomain(
  resolver: DnsResolver,
  domain: string,
  retryDelay = 500,
): Promise<MailStatus> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await checkOnce(resolver, domain);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
  return "unknown";
}

/** Checks all `domains`, `concurrency` at a time, with `timeout` ms per DNS query. */
export async function checkMailDomains(
  domains: readonly string[],
  {
    concurrency = 100,
    timeout = 5000,
    onProgress,
  }: { concurrency?: number; timeout?: number; onProgress?: (done: number) => void } = {},
): Promise<Map<string, MailStatus>> {
  const resolver = new Resolver({ timeout, tries: 2 });
  resolver.setServers(DNS_SERVERS);
  const results = new Map<string, MailStatus>();
  let next = 0;
  const worker = async () => {
    while (next < domains.length) {
      const domain = domains[next++];
      if (domain === undefined) break;
      results.set(domain, await checkDomain(resolver, domain));
      if (results.size % 5000 === 0) onProgress?.(results.size);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
