# Changelog

All notable changes to `base44-revenuecat` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every release keeps the same promise: no call ever throws, and a newer
package on an older Despia build degrades instead of breaking. Native
capabilities are probed at runtime, so you never version-match JavaScript
against a compiled binary.

## [1.3.0]

### Added

- `user()` with no argument is now a real identity read. On builds that
  support it the package asks the native RevenueCat SDK who the current
  user is and resolves `{ id, user, anonymous, registered }`, where `id` is
  the raw RevenueCat app user id (anonymous `$RCAnonymousID:...` ids
  included) and `registered` answers "is this user signed in?" in one
  boolean.
- An account the native SDK persisted across app restarts is adopted
  automatically, so client purchases and server checks keep naming the same
  RevenueCat customer after a cold start.
- `bridge` and `registered` are read from every native envelope, giving the
  package runtime capability detection instead of build guessing.

### Changed

- Purchases and paywalls now work before anyone signs in. With no account
  bound, `buy()` and `paywall()` attach to RevenueCat's own anonymous user
  (its recommended flow) and a later `user(id)` merges that history onto the
  account. The package no longer synthesizes a `b44_` id on capable builds.
- `user(id)`, `login(id)`, and `logout()` resolve the same enriched identity
  shape as `user()`.

### Compatibility

- Older builds that still require an account id keep working: a V4 module
  that rejects with `missing_param` gets one automatic retry with the
  synthesized id, and an older classic build (one that has not reported
  `bridge >= 2`) keeps receiving the synthesized id as before.
- The identity read is never fired at a build that has not proven it
  supports it, so no old binary can mistake it for a purchase.

## [1.2.0]

### Added

- Native session identity: `user(id)` binds the RevenueCat user through the
  native layer (merging anonymous purchase history at sign-in) and
  `logout()` rotates to a fresh anonymous user, so a shared device never
  shows the previous account's entitlements.
- `redeem()` presents Apple's offer-code redemption sheet on iOS, and
  resolves `{ supported: false }` on Android, in the browser, and on builds
  without it.
- `on('user', fn)` subscribes to identity changes.

### Changed

- The identity probe is fire-and-forget, so app boot is never blocked
  waiting on the native layer.
- On the classic runtime, identity commands are held back until a native
  answer has proven the build carries the bridge, so an older binary can
  never be shown a stray prompt.

## [1.1.0]

### Added

- `plans()` returns subscription plans shaped for rendering a paywall
  screen, with nested price, period, trial, and introductory offer detail
  derived from the live store catalog.
- `user(id)` / `logout()` identity handling and `info()` for a normalized
  per-entitlement view of the customer.
- Zero-secret server verification: `base44-revenuecat/server` accepts a
  RevenueCat public SDK key for entitlement checks, with the secret-key v2
  path available when you want it.

## [1.0.0]

### Added

- First release. Promise-based RevenueCat in-app purchases and
  subscriptions for Base44 apps shipped as native iOS and Android apps with
  Despia: `products()`, `buy()`, `paywall()`, `has()`, `status()`,
  `restore()`, `center()`, and event subscriptions, over one unified JSON
  contract shared by both Despia runtimes, with safe no-op resolutions in a
  plain browser.

[1.3.0]: https://github.com/despia-native/base44-revenuecat/releases/tag/v1.3.0
[1.2.0]: https://github.com/despia-native/base44-revenuecat/releases/tag/v1.2.0
[1.1.0]: https://github.com/despia-native/base44-revenuecat/releases/tag/v1.1.0
[1.0.0]: https://github.com/despia-native/base44-revenuecat/releases/tag/v1.0.0
