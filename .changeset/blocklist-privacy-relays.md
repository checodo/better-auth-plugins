---
"@checodo/better-auth-blocklist": minor
---

Privacy relays (Firefox Relay, DuckDuckGo, SimpleLogin, addy.io, Proton Pass) are no longer treated as disposable: `disposableEmailDomains` never contains them (it contained `relay.firefox.com`). The new `privacyRelayDomains` list (`/lists` and `/lists/privacy-relay-domains`) lets apps that want one account per person block them too. The lists are refreshed from their sources.
