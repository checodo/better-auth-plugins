# @checodo/better-auth-security-alerts

## 0.2.3

### Patch Changes

- c59d897: Require `better-auth` and `@better-auth/core` 1.7.27 or a later 1.x release (was 1.7.20). It brings better-auth's recent fixes, such as the origin check on anonymous sign-in and expired two-factor challenges being rejected. The plugins' own behavior is unchanged.

## 0.2.2

### Patch Changes

- 4d87d69: Forgetting a deleted user's devices now shares its code with the other plugins. A failure is logged as `[security-alerts] failed to erase the devices of a deleted user`; the behavior is unchanged.

## 0.2.1

### Patch Changes

- 6fb82ef: With `newDevice.maxDevices` above 100, every known device is now read: the device check and `listDevices` saw at most 100 of a user's devices.

## 0.2.0

### Minor Changes

- 7c1dafc: First release: tell users about security-relevant changes to their account.
  
  - `sendAlert` callback for ten alert types, each on or off: `new-device`, `password-changed`, `password-reset-requested`, `password-reset`, `email-changed` (sent to the old address, with the new one masked), `passkey-added`, `passkey-removed`, `two-factor-disabled`, `account-linked`, and `api-key-created`. Runs in the background with `advanced.backgroundTasks`; errors are logged and never fail the request.
  - New-device detection with a `knownDevice` table: a hash of the browser family, OS family, and optionally the network, keyed with the auth secret. No alert on a user's first sign-in; devices count as new again after 90 days without a sign-in (`newDevice.expiresIn`); `newDevice.isNewDevice` and `newDevice.getDevice` to decide yourself.
  - `secureAccount`: a single-use "This wasn't me" link in the alerts. The link only redirects to your confirmation page; confirming (`secureAccount`) signs out every session, makes every device new again, removes the passkey, linked account, or API key the alert was about, optionally puts the old email address back (`emailChange: "restore"`; `"keep"` by default), calls `onSecured`, and blocks the password and sends a reset link (`password: "block"`, the default), or only sends the link (`"send-reset"`), or neither (`"none"`).
  - A startup warning while `password-reset-requested` is on without `advanced.backgroundTasks` (response times would tell which emails have an account).
  - `listDevices` and `forgetDevice` endpoints for a "your devices" page.
  - `adminActions` to leave out or not mark alerts about changes an admin makes.
  - With the audit log plugin: `security.alert-sent` and `security.account-secured` events.
