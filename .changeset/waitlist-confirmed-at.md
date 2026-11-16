---
"@checodo/better-auth-waitlist": minor
---

Record when an email was confirmed, and clean up expired entries on a schedule.

- New `confirmedAt` field on `waitlistEntry`: when the person opened the confirmation link (double opt-in). It stays `null` when nobody confirmed the email: with `confirmEmail: false`, for emails an admin invited directly before they confirmed, and for entries confirmed before this release.
- With the audit log, confirmations (`waitlist.confirmed`) and people leaving through the link (`waitlist.left`) are recorded, both with severity `low` and no actor. `waitlist.left` and `waitlist.entry-deleted` are recorded once, also when the same entry is deleted by concurrent requests.
- Expired unconfirmed entries are now also deleted in the background on any waitlist request (at most once an hour), not only when someone joins. New server-only `auth.api.deleteExpiredWaitlistEntries()` for a cron job, returning `{ deleted }`.
- New `retention` option: `{ rejected, registered }` deletes rejected and registered entries after that many days (kept by default), and `sweepInterval` sets how often the cleanup runs (seconds, default `3600`).

**Migration required:** `confirmedAt` is a new optional column. Run `npx auth@latest migrate` (or `generate` for Prisma and Drizzle); existing rows get `null`.
