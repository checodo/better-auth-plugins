---
"@checodo/better-auth-referral": minor
---

`maxReferralsPerUser` is now a strict limit, also when sign-ups' transactions commit out of order. Before, a referral counted the referrer's earlier referrals once its sign-up was committed; an earlier sign-up committing later could miss a later one that had already settled, and both were kept. Now each referral takes a place, a row with a unique key in the new `referralSlot` table, and is dropped if none is free. Referrals made before this version count toward the limit.

**Migration required**: the plugin adds the `referralSlot` table (only written when `maxReferralsPerUser` is set) and three columns to `referral` (`rewardStatus`, `rewardAttempts`, `rewardAttemptAt`). Run `npx auth@latest migrate` (or `generate`) after upgrading.

Failed reward callbacks can now be retried. Each referral records the delivery of `onReferralCompleted` (new fields `rewardStatus`, `rewardAttempts`, `rewardAttemptAt`): `"pending"` until the callback returns without an error, then `"rewarded"`. The new server-only `auth.api.retryReferralRewards()`, called from a cron job, calls it again for referrals whose call failed or never finished, after `rewardRetry.delay` (default 5 minutes) and up to `rewardRetry.maxAttempts` calls (default 10). Concurrent retries don't deliver the same attempt twice. Referrals completed before this version, or without `onReferralCompleted` set, are never retried. Delivery is at least once, so make rewards idempotent on `referral.id`; the docs no longer say "exactly once". See "Delivering rewards" in the docs.
