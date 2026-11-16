---
"@checodo/better-auth-blocklist": minor
---

Add `password` and `ip` targets.

- `password`: rules for new passwords on sign-up, change, reset (link, email OTP, phone OTP), and admin create-user/set-password, compared case-insensitively and with leetspeak folded. With the `password` option set, a context check also blocks passwords that contain the email's local part, the username, or `appName` (`checkContext`). Passwords are never passed to `onBlocked` or the audit log (`"[redacted]"`). New error codes `PASSWORD_NOT_ALLOWED` and `PASSWORD_CONTAINS_CONTEXT_WORD`.
- `ip`: block sign-ups and sign-ins from IP addresses, CIDR ranges (IPv4 and IPv6, new `cidr` rule type), and countries (new `country` rule type, via `getCountry`), with a `403 IP_ADDRESS_NOT_ALLOWED`. `scope` picks `"sign-up"`, `"sign-in"`, or both. The address is read like better-auth's rate limiter reads it (`advanced.ipAddress`).
- The rule endpoints accept the new targets and rule types (new error codes `RULE_TYPE_NOT_SUPPORTED_FOR_TARGET`, `INVALID_IP_RULE`, `COUNTRY_RULES_REQUIRE_GET_COUNTRY`).

Note: `BlocklistTarget` and `BlocklistMatchType` gain new members, so an exhaustive `switch` over them in an `onBlocked` callback needs the new cases. Rules stored for `password` and `ip` apply even without the new options, like for the other targets.
