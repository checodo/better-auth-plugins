---
"@checodo/better-auth-referral": minor
---

Record rewards that failed for good. With the audit log, when `onReferralCompleted` throws on its last attempt (`rewardRetry.maxAttempts`), a `referral.reward-failed` event is recorded (severity `high`, `userId`: the referrer, `metadata`: `referralId`, `referredUserId`, `attempts`), once per referral, so the audit log's `onEvent` can alert on a reward that will never be granted.
