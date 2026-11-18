# @checodo/better-auth-audit-log

## 0.3.0

### Minor Changes

- 4dbc521: Send audit events to more places with the new `destinations` option: a SIEM, a log service, or a webhook, each with its own event filter, `transform`, and batching. Sending runs in the background and is best effort; a failing or slow destination never fails the request. `auth.api.flushAuditDestinations()` sends waiting batches before shutdown.
  
  The new `@checodo/better-auth-audit-log/destinations` entry point has `httpDestination` (JSON or NDJSON, optional Standard Webhooks signature, never follows redirects) and `consoleDestination`.
  
  A custom `storage` now only needs `write`: without `read`, `listEvents` answers `READ_NOT_SUPPORTED` (501); without `deleteOlderThan`, `retention` is refused at startup and `deleteExpiredAuditEvents` answers `DELETE_NOT_SUPPORTED` (501). Existing storages keep working.
- 46134cf: Export audit events and verify the hash chain over HTTP, for admins.
  
  - `GET /audit-log/export` (`auth.api.exportAuditEvents`): NDJSON or CSV, newest first, with the same filters as `listEvents`. Up to 10,000 events per request; the `x-next-cursor` response header continues the export, unaffected by new events. CSV cells that a spreadsheet would run as a formula get a leading `'`.
  - `POST /audit-log/verify-chain` (`auth.api.verifyAuditChain`): now also reachable over HTTP, at most 10,000 links per request. The new `afterSequence` and `limit` options check the chain in parts; the result's new `nextSequence` continues the check.
  - Both are admins only over HTTP (new error codes `YOU_ARE_NOT_ALLOWED_TO_EXPORT_EVENTS`, `YOU_ARE_NOT_ALLOWED_TO_VERIFY_THE_CHAIN`, `INVALID_CURSOR`) and rate limited to 10 requests a minute. Calls from server code without headers need no session, as before.

## 0.2.2

### Patch Changes

- 28c6ce1: Internal: the detection of sign-ins, password resets, and email and two-factor changes moved into code shared with the other plugins. No change in the events recorded.

## 0.2.1

### Patch Changes

- 6babf6c: The npm page now links to the plugin's docs on the docs site (`homepage` and the README's Documentation link). Each GitHub release now carries the published tarball, its SBOM, and a Sigstore bundle with signed build provenance (`gh attestation verify <file> --repo checodo/better-auth-plugins`). No code changes.

## 0.2.0

### Minor Changes

- debe1ae: First release: an audit log of sign-ins, failed sign-ins, account changes, and admin actions. Users see their own history, admins everyone's.
