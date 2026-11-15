/**
 * Consonants and digits. No look-alikes (0/O, 1/I/L), and no vowels
 * (A, E, I, O, U, Y), so random codes can't spell words, offensive ones
 * included.
 */
export const CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXZ23456789";

/** What a code may look like once normalized: letters, digits, `-`, `_`. */
export const CODE_PATTERN = /^[A-Z0-9_-]{4,64}$/;

/** A random code of `length` characters from `CODE_ALPHABET`, without modulo bias. */
export function generateCode(length: number): string {
  // 27 symbols: reject bytes >= 243 (9 * 27) so every symbol is equally likely.
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let code = "";
  while (code.length < length) {
    // Web Crypto: available in Node, browsers, and edge runtimes alike.
    for (const byte of crypto.getRandomValues(new Uint8Array(length * 2))) {
      if (byte >= limit) continue;
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (code.length === length) break;
    }
  }
  return code;
}

/** Trims and uppercases a code, the way codes are stored and compared. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Whether `code` (normalized) is a well-formed code. */
export function isWellFormedCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}
