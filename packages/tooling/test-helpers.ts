/**
 * Test helpers shared by the plugins' `official-plugins.test.ts`, for
 * official better-auth plugins whose flows take more than a call:
 * Sign-In with Ethereum (SIWE). No better-auth import: the types below
 * describe only what the helpers use.
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
