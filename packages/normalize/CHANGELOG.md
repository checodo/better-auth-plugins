# @checodo/better-auth-normalize

## 0.2.0

### Minor Changes

- 2e6b989: First release: email and phone number normalization.
  
  - `emailNormalization()` (`/email`): stores the address an email reaches in `user.normalizedEmail` (unique): trimmed, lowercased, and the tags (and Gmail's dots) that Gmail, Outlook, iCloud, Proton, and Fastmail ignore removed, or `+tags` at every domain with `subaddressing: "all"`. A second account for the same inbox is refused on every way of creating a user or changing an email, with better-auth's own answer for an existing email (`USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, or, where better-auth hides existing users, its success-shaped response and `onExistingUserSignUp`). `allowNormalizedSignIn` lets people sign in with any form of their address. `backfillNormalizedEmails` fills existing users a batch at a time and reports inboxes with two accounts. With the audit log, refusals are recorded as `normalize.email-alias-refused`.
  - `phoneNormalization()` (`/phone`): stores every number of better-auth's `phoneNumber` plugin in E.164 and refuses invalid ones (`INVALID_PHONE_NUMBER`), with `defaultCountry` for national numbers.
