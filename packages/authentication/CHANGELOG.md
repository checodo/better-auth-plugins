# @checodo/better-auth-authentication

## 0.2.2

### Patch Changes

- c59d897: Require `better-auth` and `@better-auth/core` 1.7.27 or a later 1.x release (was 1.7.20). It brings better-auth's recent fixes, such as the origin check on anonymous sign-in and expired two-factor challenges being rejected. The plugins' own behavior is unchanged.

## 0.2.1

### Patch Changes

- 6babf6c: The npm page now links to the plugin's docs on the docs site (`homepage` and the README's Documentation link). Each GitHub release now carries the published tarball, its SBOM, and a Sigstore bundle with signed build provenance (`gh attestation verify <file> --repo checodo/better-auth-plugins`). No code changes.

## 0.2.0

### Minor Changes

- debe1ae: First release: sign in with Steam, Epic Games, and Xbox through better-auth's own `signIn.social`, like any built-in social provider.
