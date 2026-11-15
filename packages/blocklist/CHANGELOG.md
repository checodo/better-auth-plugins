# @checodo/better-auth-blocklist

## 0.2.1

### Patch Changes

- 6babf6c: The npm page now links to the plugin's docs on the docs site (`homepage` and the README's Documentation link). Each GitHub release now carries the published tarball, its SBOM, and a Sigstore bundle with signed build provenance (`gh attestation verify <file> --repo checodo/better-auth-plugins`). No code changes.

## 0.2.0

### Minor Changes

- debe1ae: First release: block disposable email domains, reserved usernames, and unwanted organization and team names, with ready-made lists.

### Patch Changes

- ca3e8cc: Drop trailing dots from emails and domains without a regex, so a long run of dots can't slow down matching.
