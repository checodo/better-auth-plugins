---
"@checodo/better-auth-security-alerts": patch
---

With `newDevice.maxDevices` above 100, every known device is now read: the device check and `listDevices` saw at most 100 of a user's devices.
