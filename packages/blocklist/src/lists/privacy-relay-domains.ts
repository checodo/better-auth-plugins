/**
 * Domains of privacy relays: services that give people a separate address
 * per site and forward it to their real inbox. Not disposable, so
 * `disposableEmailDomains` never contains them. One person can have many
 * relay addresses, so apps that want one account per person can block or
 * flag them with this list. Written by hand and checked against each
 * service's documentation.
 */
export const privacyRelayDomains: readonly string[] = Object.freeze([
  // Not listed: Fastmail Masked Email and iCloud Hide My Email use the
  // provider's own domains (fastmail.com, icloud.com). Neither is Sign in
  // with Apple's `privaterelay.appleid.com`: it gives one address per Apple
  // ID and app, and blocking it would lock out everyone who hides their
  // email there.
  "33mail.com",
  // addy.io (formerly AnonAddy)
  "addy.io",
  "anonaddy.com",
  "anonaddy.me",
  // SimpleLogin
  "aleeas.com",
  "simplelogin.co",
  "simplelogin.com",
  "slmail.me",
  // DuckDuckGo Email Protection
  "duck.com",
  // Firefox Relay (`relay.firefox.com` for addresses made before 2022)
  "mozmail.com",
  "relay.firefox.com",
  // Proton Pass
  "passinbox.com",
  "passmail.net",
]);
