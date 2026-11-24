---
"@checodo/better-auth-audit-log": patch
"@checodo/better-auth-authentication": patch
"@checodo/better-auth-blocklist": patch
"@checodo/better-auth-normalize": patch
"@checodo/better-auth-referral": patch
"@checodo/better-auth-security-alerts": patch
"@checodo/better-auth-waitlist": patch
---

Require `better-auth` and `@better-auth/core` 1.7.27 or a later 1.x release (was 1.7.20). It brings better-auth's recent fixes, such as the origin check on anonymous sign-in and expired two-factor challenges being rejected. The plugins' own behavior is unchanged.
