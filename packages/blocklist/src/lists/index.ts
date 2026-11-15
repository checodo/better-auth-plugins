/**
 * Predefined lists to plug into `blocklist()`. Opt-in, and a separate
 * entry point, so apps that don't import it don't load the data.
 *
 * @example
 * ```ts
 * import { blocklist } from "@checodo/better-auth-blocklist";
 * import {
 *   disposableEmailDomains,
 *   reservedUsernames,
 * } from "@checodo/better-auth-blocklist/lists";
 *
 * blocklist({
 *   email: { domains: disposableEmailDomains },
 *   username: { values: reservedUsernames },
 *   organization: { values: reservedUsernames },
 * });
 * ```
 */
export { disposableEmailDomains } from "./disposable-email-domains";
export { reservedUsernames } from "./reserved-usernames";
