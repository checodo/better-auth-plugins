---
"@checodo/better-auth-waitlist": patch
---

Fix two rare outcomes of confirming an email at the same moment as something else changes the entry, and refuse durations no date can hold.

- A confirmation that finds the waitlist over `maxEntries` while an admin has just approved or rejected the same entry no longer answers `WAITLIST_FULL`: the confirmation stands, keeps its `confirmedAt`, and is recorded as `waitlist.confirmed`.
- A confirmation link whose entry is deleted while it is being confirmed (its link expired and the cleanup removed it) now answers `INVALID_TOKEN` instead of `success`.
- `confirmationExpiresIn`, `retention.rejected`, and `retention.registered` must be at most 100 years (36,500 days). Larger values put the cleanup's cutoff outside the range of a date, so every cleanup failed.
