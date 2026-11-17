---
"@checodo/better-auth-referral": patch
---

Fix `maxReferralsPerUser` being exceeded after it was lowered: when sign-ups with the same code settled at the same time, places taken under the higher limit weren't counted, so the referrer could end up with more referrals than the new limit.
