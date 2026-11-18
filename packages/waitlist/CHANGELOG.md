# @checodo/better-auth-waitlist

## 0.5.0

### Minor Changes

- 4d87d69: Deleting a user now deletes their waitlist entry, which holds their email address. Before, the entry stayed (marked `registered`) until an admin deleted it or `retention` removed it. If you need to keep it, read it in a `user.delete.before` database hook first.

## 0.4.1

### Patch Changes

- 7c1dafc: Internal: the shared helper that runs user callbacks can now also report failures (used by the security alerts plugin). No change in behavior.

## 0.4.0

### Minor Changes

- 01f3d0b: Record when an email was confirmed, and clean up expired entries on a schedule.
  
  - New `confirmedAt` field on `waitlistEntry`: when the person opened the confirmation link (double opt-in). It stays `null` when nobody confirmed the email: with `confirmEmail: false`, for emails an admin invited directly before they confirmed, and for entries confirmed before this release.
  - With the audit log, confirmations (`waitlist.confirmed`) and people leaving through the link (`waitlist.left`) are recorded, both with severity `low` and no actor. `waitlist.left` and `waitlist.entry-deleted` are recorded once, also when the same entry is deleted by concurrent requests.
  - Expired unconfirmed entries are now also deleted in the background on any waitlist request (at most once an hour), not only when someone joins. New server-only `auth.api.deleteExpiredWaitlistEntries()` for a cron job, returning `{ deleted }`.
  - New `retention` option: `{ rejected, registered }` deletes rejected and registered entries after that many days (kept by default), and `sweepInterval` sets how often the cleanup runs (seconds, default `3600`).
  
  **Migration required:** `confirmedAt` is a new optional column. Run `npx auth@latest migrate` (or `generate` for Prisma and Drizzle); existing rows get `null`.

### Patch Changes

- 50f8e3f: Fix two rare outcomes of confirming an email at the same moment as something else changes the entry, and refuse durations no date can hold.
  
  - A confirmation that finds the waitlist over `maxEntries` while an admin has just approved or rejected the same entry no longer answers `WAITLIST_FULL`: the confirmation stands, keeps its `confirmedAt`, and is recorded as `waitlist.confirmed`.
  - A confirmation link whose entry is deleted while it is being confirmed (its link expired and the cleanup removed it) now answers `INVALID_TOKEN` instead of `success`.
  - `confirmationExpiresIn`, `retention.rejected`, and `retention.registered` must be at most 100 years (36,500 days). Larger values put the cleanup's cutoff outside the range of a date, so every cleanup failed.

## 0.3.0

### Minor Changes

- daa1c02: Make waitlist state changes safe under concurrent requests. Each transition that sends an email or runs a callback is now a conditional update that only applies while the entry is as it was read:
  
  - Joining again with an unconfirmed email at the same time from several requests renews the confirmation link once and sends one email, so the limit of 4 confirmation emails per address holds.
  - Opening a confirmation link several times at once confirms the entry once: `onJoin` and `autoApprove` run once, and only one invite is sent. A confirmation that finds the waitlist full no longer reverts an entry another request has moved on.
  - Two admins approving or renewing the same entry at once send one invite, whose code is the one stored.
  - Rejecting no longer overwrites a sign-up or approval that happened meanwhile.
  
  New error code `ENTRY_CHANGED` (`409`): `rejectEntry` and `createInvite` return it when another request changed the entry first; load it again and retry. `approveEntries` skips such entries, like registered ones.

## 0.2.1

### Patch Changes

- 6babf6c: The npm page now links to the plugin's docs on the docs site (`homepage` and the README's Documentation link). Each GitHub release now carries the published tarball, its SBOM, and a Sigstore bundle with signed build provenance (`gh attestation verify <file> --repo checodo/better-auth-plugins`). No code changes.

## 0.2.0

### Minor Changes

- debe1ae: First release: gate sign-ups behind a waitlist with admin approval and invite codes.
