---
"@checodo/better-auth-blocklist": patch
---

Correct the description of `password.checkContext`: it compares parts of the password, so it is stricter than NIST SP 800-63B's whole-password blocklist (it said it was what NIST asks for). No change in behavior.
