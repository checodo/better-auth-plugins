import { createHmac } from "node:crypto";

/**
 * Test helpers shared by the plugins: the database `getTestInstance`
 * uses (`testDatabase`), and, for `official-plugins.test.ts`, official
 * better-auth plugins whose flows take more than a call: Sign-In with
 * Ethereum (SIWE), and the codes of the two-factor plugin (TOTP). No
 * better-auth import: the types below describe only
 * what the helpers use.
 */

/** A well-known, checksummed wallet address. */
export const TEST_WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const DOMAIN = "example.com";

/** Options for the `siwe()` plugin: this domain, random nonces, any signature accepted. */
export const siweTestOptions = {
  domain: DOMAIN,
  getNonce: async () => `nonce${Math.random().toString(36).slice(2, 12)}`,
  verifyMessage: async () => true,
};

/** An EIP-4361 (Sign-In with Ethereum) message, as a wallet would sign it. */
export function siweMessage(nonce: string, address = TEST_WALLET): string {
  return [
    `${DOMAIN} wants you to sign in with your Ethereum account:`,
    address,
    "",
    `URI: https://${DOMAIN}`,
    "Version: 1",
    "Chain ID: 1",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

interface SiweAuth {
  handler: (request: Request) => Promise<Response>;
  api: { getSiweNonce: (input: { body: Record<string, never> }) => Promise<{ nonce: string }> };
}

/**
 * Signs in with `TEST_WALLET` through the HTTP handler (`/siwe/verify`
 * needs a real request), with an optional email and extra headers.
 */
export async function signInWithWallet(
  auth: SiweAuth,
  baseURL: string,
  { email, headers = {} }: { email?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { nonce } = await auth.api.getSiweNonce({ body: {} });
  const response = await auth.handler(
    new Request(`${baseURL}/siwe/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: new URL(baseURL).origin, ...headers },
      body: JSON.stringify({
        message: siweMessage(nonce),
        signature: "0xsignature",
        ...(email ? { email } : {}),
      }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/**
 * Where `getTestInstance` keeps its data, from `TEST_DATABASE`: SQLite in
 * memory when unset (the default for `pnpm test`), or `postgres` / `mysql`
 * / `mongodb` on the servers better-auth's test helper expects (see
 * `docker-compose.test.yml`). Postgres and MySQL run with transactions
 * on, so hooks run in real transactions; MongoDB without (a single server
 * has none, like most MongoDB setups the adapter sees). Spread into the
 * second argument of `getTestInstance`.
 */
export function testDatabase(): {
  testWith?: "postgres" | "mysql" | "mongodb";
  transaction?: boolean;
} {
  const database = process.env.TEST_DATABASE;
  if (!database || database === "sqlite") return {};
  if (database === "postgres" || database === "mysql") {
    return { testWith: database, transaction: true };
  }
  if (database === "mongodb") return { testWith: database };
  throw new Error(
    `TEST_DATABASE must be "sqlite", "postgres", "mysql", or "mongodb", got "${database}".`,
  );
}

/** The part of better-auth's `AuthContext` that `resetTestDatabase` uses. */
interface ResettableContext {
  tables: Record<string, unknown>;
  adapter: { deleteMany: (input: { model: string; where: [] }) => Promise<number> };
}

/**
 * Empties every table of a fresh test instance on MongoDB, and does
 * nothing on the other databases. `getTestInstance` gives each instance
 * its own Postgres schema or MySQL database, but one MongoDB database per
 * test file, so rows of earlier tests (users with the same email) would
 * still be there. Call it right after `getTestInstance`.
 */
export async function resetTestDatabase(context: ResettableContext): Promise<void> {
  if (process.env.TEST_DATABASE !== "mongodb") return;
  for (const model of Object.keys(context.tables)) {
    await context.adapter.deleteMany({ model, where: [] });
  }
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) for a base32 secret, as authenticator apps compute it. */
export function totp(base32: string, at = Date.now()): string {
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
