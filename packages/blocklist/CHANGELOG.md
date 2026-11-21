# @checodo/better-auth-blocklist

## 0.4.0

### Minor Changes

- 2e6b989: Privacy relays (Firefox Relay, DuckDuckGo, SimpleLogin, addy.io, Proton Pass) are no longer treated as disposable: `disposableEmailDomains` never contains them (it contained `relay.firefox.com`). The new `privacyRelayDomains` list (`/lists` and `/lists/privacy-relay-domains`) lets apps that want one account per person block them too. The lists are refreshed from their sources.

## 0.3.2

### Patch Changes

- 6fb82ef: Security fix: rules stored in the database are now all checked. Only the first 100 rules of each target were read, because better-auth's adapters return at most 100 rows unless told otherwise, so with more than 100 stored rules for a target (emails, usernames, IP addresses...) the newer ones were silently ignored. `listRules` now also returns every rule.

## 0.3.1

### Patch Changes

- 28c6ce1: Correct the description of `password.checkContext`: it compares parts of the password, so it is stricter than NIST SP 800-63B's whole-password blocklist (it said it was what NIST asks for). No change in behavior.

## 0.3.0

### Minor Changes

- 51408d6: Add `password` and `ip` targets.
  
  - `password`: rules for new passwords on sign-up, change, set (server-only `setPassword`), reset (link, email OTP, phone OTP), and admin create-user/set-password, compared case-insensitively and with leetspeak folded. With the `password` option set, a context check also blocks passwords that contain the email's local part, the username, or `appName` (`checkContext`). Passwords are never passed to `onBlocked` or the audit log: the value and the matched password rule's value are `"[redacted]"`, since an `exact` rule is the password itself (only the context check's `"[email]"`, `"[username]"`, `"[appName]"` are kept). New error codes `PASSWORD_NOT_ALLOWED` and `PASSWORD_CONTAINS_CONTEXT_WORD`.
  - `ip`: block sign-ups and sign-ins from IP addresses, CIDR ranges (IPv4 and IPv6, new `cidr` rule type), and countries (new `country` rule type, via `getCountry`; an error thrown by `getCountry` is logged and the country counts as unknown), with a `403 IP_ADDRESS_NOT_ALLOWED`. `scope` picks `"sign-up"`, `"sign-in"`, or both. The address is read like better-auth's rate limiter reads it (`advanced.ipAddress`).
  - The rule endpoints accept the new targets and rule types (new error codes `RULE_TYPE_NOT_SUPPORTED_FOR_TARGET`, `INVALID_IP_RULE`, `COUNTRY_RULES_REQUIRE_GET_COUNTRY`).
  
  Note: `BlocklistTarget` and `BlocklistMatchType` gain new members, so an exhaustive `switch` over them in an `onBlocked` callback needs the new cases. Rules stored for `password` and `ip` apply even without the new options, like for the other targets.

## 0.2.1

### Patch Changes

- 6babf6c: The npm page now links to the plugin's docs on the docs site (`homepage` and the README's Documentation link). Each GitHub release now carries the published tarball, its SBOM, and a Sigstore bundle with signed build provenance (`gh attestation verify <file> --repo checodo/better-auth-plugins`). No code changes.

## 0.2.0

### Minor Changes

- debe1ae: First release: block disposable email domains, reserved usernames, and unwanted organization and team names, with ready-made lists.

### Patch Changes

- ca3e8cc: Drop trailing dots from emails and domains without a regex, so a long run of dots can't slow down matching.
