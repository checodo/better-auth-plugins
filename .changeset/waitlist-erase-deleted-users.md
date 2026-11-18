---
"@checodo/better-auth-waitlist": minor
---

Deleting a user now deletes their waitlist entry, which holds their email address. Before, the entry stayed (marked `registered`) until an admin deleted it or `retention` removed it. If you need to keep it, read it in a `user.delete.before` database hook first.
