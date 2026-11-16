---
"@checodo/better-auth-referral": minor
---

`maxReferralsPerUser` is now a strict limit, also when sign-ups' transactions commit out of order. Before, a referral counted the referrer's earlier referrals once its sign-up was committed; an earlier sign-up committing later could miss a later one that had already settled, and both were kept. Now each referral takes a place, a row with a unique key in the new `referralSlot` table, and is dropped if none is free. Referrals made before this version count toward the limit.

**Migration required**: the plugin adds the `referralSlot` table. Run `npx auth@latest migrate` (or `generate`) after upgrading. It is only written when `maxReferralsPerUser` is set.

The docs and JSDoc no longer say `onReferralCompleted` runs "exactly once": it runs at most once per referral and is not retried if it throws or the process stops. See "Delivering rewards" in the docs for making rewards idempotent and reconciling them.
