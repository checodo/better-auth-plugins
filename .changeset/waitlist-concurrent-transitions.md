---
"@checodo/better-auth-waitlist": minor
---

Make waitlist state changes safe under concurrent requests. Each transition that sends an email or runs a callback is now a conditional update that only applies while the entry is as it was read:

- Joining again with an unconfirmed email at the same time from several requests renews the confirmation link once and sends one email, so the limit of 4 confirmation emails per address holds.
- Opening a confirmation link several times at once confirms the entry once: `onJoin` and `autoApprove` run once, and only one invite is sent. A confirmation that finds the waitlist full no longer reverts an entry another request has moved on.
- Two admins approving or renewing the same entry at once send one invite, whose code is the one stored.
- Rejecting no longer overwrites a sign-up or approval that happened meanwhile.

New error code `ENTRY_CHANGED` (`409`): `rejectEntry` and `createInvite` return it when another request changed the entry first; load it again and retry. `approveEntries` skips such entries, like registered ones.
