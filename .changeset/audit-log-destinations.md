---
"@checodo/better-auth-audit-log": minor
---

Send audit events to more places with the new `destinations` option: a SIEM, a log service, or a webhook, each with its own event filter, `transform`, and batching. Sending runs in the background and is best effort; a failing or slow destination never fails the request. `auth.api.flushAuditDestinations()` sends waiting batches before shutdown.

The new `@checodo/better-auth-audit-log/destinations` entry point has `httpDestination` (JSON or NDJSON, optional Standard Webhooks signature, never follows redirects) and `consoleDestination`.

A custom `storage` now only needs `write`: without `read`, `listEvents` answers `READ_NOT_SUPPORTED` (501); without `deleteOlderThan`, `retention` is refused at startup and `deleteExpiredAuditEvents` answers `DELETE_NOT_SUPPORTED` (501). Existing storages keep working.
