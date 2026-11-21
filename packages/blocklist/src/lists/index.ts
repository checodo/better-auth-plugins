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
 *   email: { domains: disposableEmailDomains }, // privacyRelayDomains too, to block relays

 *   username: { values: reservedUsernames },
 *   organization: { values: reservedUsernames },
 * });
 * ```
 */
export { disposableEmailDomains } from "./disposable-email-domains";
export { privacyRelayDomains } from "./privacy-relay-domains";
export { reservedUsernames } from "./reserved-usernames";
