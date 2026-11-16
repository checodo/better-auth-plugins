/**
 * Test helpers shared by the plugins: the database `getTestInstance`
 * uses (`testDatabase`), and, for `official-plugins.test.ts`, official
 * better-auth plugins whose flows take more than a call: Sign-In with
 * Ethereum (SIWE). No better-auth import: the types below describe only
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
 * on the servers better-auth's test helper expects (see `docker-compose.test.yml`),
 * with transactions on, so hooks run in real transactions. Spread into
 * the second argument of `getTestInstance`.
 */
export function testDatabase(): { testWith?: "postgres" | "mysql"; transaction?: boolean } {
  const database = process.env.TEST_DATABASE;
  if (!database || database === "sqlite") return {};
  if (database === "postgres" || database === "mysql") {
    return { testWith: database, transaction: true };
  }
  throw new Error(`TEST_DATABASE must be "sqlite", "postgres", or "mysql", got "${database}".`);
}
