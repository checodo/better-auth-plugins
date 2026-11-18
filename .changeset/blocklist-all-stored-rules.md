---
"@checodo/better-auth-blocklist": patch
---

Security fix: rules stored in the database are now all checked. Only the first 100 rules of each target were read, because better-auth's adapters return at most 100 rows unless told otherwise, so with more than 100 stored rules for a target (emails, usernames, IP addresses...) the newer ones were silently ignored. `listRules` now also returns every rule.
