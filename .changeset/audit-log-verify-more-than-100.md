---
"@checodo/better-auth-audit-log": patch
---

`verifyAuditChain` no longer reports false `missing-event` problems once the chain has more than 100 links. It read the events of up to 500 links at a time, but got at most 100 back.
