---
"@checodo/better-auth-referral": minor
---

Deleting a user now deletes their referral code, the referrals they made or that brought them, and those referrals' steps and places on every adapter. Before, this relied on foreign keys, so with MongoDB, SQLite without `PRAGMA foreign_keys`, or a custom adapter the rows stayed. Nothing changes where foreign keys already deleted them.
