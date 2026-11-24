# @checodo/better-auth-referral

## 0.5.1

### Patch Changes

- c59d897: Require `better-auth` and `@better-auth/core` 1.7.27 or a later 1.x release (was 1.7.20). It brings better-auth's recent fixes, such as the origin check on anonymous sign-in and expired two-factor challenges being rejected. The plugins' own behavior is unchanged.

## 0.5.0

### Minor Changes

- 4d87d69: Deleting a user now deletes their referral code, the referrals they made or that brought them, and those referrals' steps and places on every adapter. Before, this relied on foreign keys, so with MongoDB, SQLite without `PRAGMA foreign_keys`, or a custom adapter the rows stayed. Nothing changes where foreign keys already deleted them.

## 0.4.2

### Patch Changes

- 6fb82ef: Referral lists now show every completed step: with more than 100 steps on one page of referrals, the rest were left out.

## 0.4.1

### Patch Changes

- 7c1dafc: Internal: the shared helper that runs user callbacks can now also report failures (used by the security alerts plugin). No change in behavior.

## 0.4.0

### Minor Changes

- edbec35: Record rewards that failed for good. With the audit log, when `onReferralCompleted` throws on its last attempt (`rewardRetry.maxAttempts`), a `referral.reward-failed` event is recorded (severity `high`, `userId`: the referrer, `metadata`: `referralId`, `referredUserId`, `attempts`), once each time a referral's attempts run out, so the audit log's `onEvent` can alert on a reward that will never be granted.

### Patch Changes

- 1205fac: Fix `maxReferralsPerUser` being exceeded after it was lowered: when sign-ups with the same code settled at the same time, places taken under the higher limit weren't counted, so the referrer could end up with more referrals than the new limit.

## 0.3.0

### Minor Changes

- daa1c02: `maxReferralsPerUser` is now a strict limit, also when sign-ups' transactions commit out of order. Before, a referral counted the referrer's earlier referrals once its sign-up was committed; an earlier sign-up committing later could miss a later one that had already settled, and both were kept. Now each referral takes a place, a row with a unique key in the new `referralSlot` table, and is dropped if none is free. Referrals made before this version count toward the limit.
  
  **Migration required**: the plugin adds the `referralSlot` table (only written when `maxReferralsPerUser` is set) and three columns to `referral` (`rewardStatus`, `rewardAttempts`, `rewardAttemptAt`). Run `npx auth@latest migrate` (or `generate`) after upgrading.
  
  Failed reward callbacks can now be retried. Each referral records the delivery of `onReferralCompleted` (new fields `rewardStatus`, `rewardAttempts`, `rewardAttemptAt`): `"pending"` until the callback returns without an error, then `"rewarded"`. The new server-only `auth.api.retryReferralRewards()`, called from a cron job, calls it again for referrals whose call failed or never finished, after `rewardRetry.delay` (default 5 minutes) and up to `rewardRetry.maxAttempts` calls (default 10). Concurrent retries don't deliver the same attempt twice. Referrals completed before this version, or without `onReferralCompleted` set, are never retried. Delivery is at least once, so make rewards idempotent on `referral.id`; the docs no longer say "exactly once". See "Delivering rewards" in the docs.

## 0.2.1

### Patch Changes

- 6babf6c: The npm page now links to the plugin's docs on the docs site (`homepage` and the README's Documentation link). Each GitHub release now carries the published tarball, its SBOM, and a Sigstore bundle with signed build provenance (`gh attestation verify <file> --repo checodo/better-auth-plugins`). No code changes.

## 0.2.0

### Minor Changes

- debe1ae: First release: referral codes, sign-up attribution, and reward steps.
