---
"@checodo/better-auth-audit-log": minor
---

Export audit events and verify the hash chain over HTTP, for admins.

- `GET /audit-log/export` (`auth.api.exportAuditEvents`): NDJSON or CSV, newest first, with the same filters as `listEvents`. Up to 10,000 events per request; the `x-next-cursor` response header continues the export, unaffected by new events. CSV cells that a spreadsheet would run as a formula get a leading `'`.
- `POST /audit-log/verify-chain` (`auth.api.verifyAuditChain`): now also reachable over HTTP, at most 10,000 links per request. The new `afterSequence` and `limit` options check the chain in parts; the result's new `nextSequence` continues the check.
- Both are admins only over HTTP (new error codes `YOU_ARE_NOT_ALLOWED_TO_EXPORT_EVENTS`, `YOU_ARE_NOT_ALLOWED_TO_VERIFY_THE_CHAIN`, `INVALID_CURSOR`) and rate limited to 10 requests a minute. Calls from server code without headers need no session, as before.
