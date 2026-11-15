/**
 * How a user signed in or up, from the endpoint that did it:
 * `/sign-in/email` → `email`, `/callback/github` → `github`,
 * `/magic-link/verify` → `magic-link`, `/two-factor/verify-totp` → `two-factor`.
 */
export function signInMethod(
  path: string | undefined,
  params?: Record<string, unknown> | undefined,
  body?: Record<string, unknown> | undefined,
): string | null {
  // OAuth callbacks (`/callback/:id`, generic OAuth's `/oauth2/callback/:providerId`).
  const provider = params?.id ?? params?.providerId;
  if (typeof provider === "string" && provider) return provider;
  if (!path) return null;
  // `/sign-in/social` with an ID token signs in without a redirect.
  if (path === "/sign-in/social" && typeof body?.provider === "string") return body.provider;
  const [first, second] = path.split("/").filter(Boolean);
  if ((first === "sign-in" || first === "sign-up") && second) return second;
  return first ?? null;
}
