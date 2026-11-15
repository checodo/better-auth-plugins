import { generateRandomString } from "better-auth/crypto";

/**
 * Entry tokens and invite codes are stored as SHA-256 hashes, like
 * passwords: someone who can read the database (a backup, a leaked
 * replica) can't confirm, check, leave, or sign up with them. The secrets
 * themselves only go out by email (and to `onJoin` and the admin who
 * issues an invite). They are long random strings, so an unsalted hash is
 * enough.
 */
export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A new random secret of `length` letters and digits, and the hash to store for it. */
export async function newSecret(length: number): Promise<{ value: string; hash: string }> {
  const value = generateRandomString(length, "a-z", "A-Z", "0-9");
  return { value, hash: await hashSecret(value) };
}
