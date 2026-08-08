# Changelog

All notable changes to `base44-revenuecat` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every release keeps the same promise: no call ever throws, and a newer
package on an older Despia build degrades instead of breaking. Native
capabilities are probed at runtime, so you never version-match JavaScript
against a compiled binary.

## [1.4.3]

Documentation only. No runtime change: `index.js`, the type definitions, and
both server entries are byte-identical to 1.4.2. Published so the npm page,
which renders the README from the published tarball, carries the corrected
badges.

### Fixed

- The types and license badges linked relatively, which resolves on GitHub but
  not on npmjs.com, so two of four badges were dead links on the page most
  people actually see. Both now use absolute URLs.
- The license badge rendered "package not found" because of the legacy `.svg`
  suffix on the shields endpoint. Dropped from every badge URL.

### Changed

- The badge row is now version, tests, types, license, and dependency count.
  The monthly downloads badge is gone: it reported zero on an hours-old
  package. Every badge URL was fetched and read before shipping, so each one
  is known to render its true value rather than an error string.
- Alt text now states the fact each badge carries, so if the images fail to
  load, which is common on npmjs.com, the line still reads as intended
  information ("on npm, tests passing, TypeScript types, Apache-2.0 licensed,
  zero dependencies") instead of a row of broken labels.

## [1.4.2]

### Fixed

- **A filtered offering could return the whole catalog.** On a build without
  the `catalog` action, asking for one offering by id filtered the fallback
  result only when it matched something, so an unknown id fell through to
  every offering. A win-back or test price could be rendered to a full-price
  user. An unknown id now answers `offeringNotFoundError` with no products,
  exactly like the native catalog action does.
- **A paying subscriber could read as not entitled.** On a build with the
  `entitlements` action but no `customer` envelope, an empty entitlements
  answer (a project with nothing mapped) outranked the device's store
  history, so `has('premium')` returned false for a live subscription. The
  entitlements read now wins only when it actually reports something, and an
  empty answer is the last resort rather than the first.
- **Calls were slow on builds that exclude RevenueCat.** The module-bus wait
  gated on the wire, which every Framework surface carries, so a build
  without the module waited the full two seconds per call (six seconds for
  `plans()`). A bound bus without the module now answers immediately.
- **A page-defined `window.dsx` could disable purchases on the classic
  runtime.** Detection checked the writable `dsx` global before the user
  agent, so a page (or another library) defining it made a classic app look
  like a Framework one, after which every call failed and no URL scheme was
  ever fired. The locked `__dsxWire` is now checked first, then the user
  agent, then the bus.
- **The legacy offerings channel invented values.** It reports only a display
  string and a payment mode, so hardcoding a zero price and a single cycle
  made every paid introductory offer read as a zero-price pay-up-front. Price
  and cycles are now reported as unknown, and the store's own payment mode is
  carried on `intro.mode` and preferred when shaping plans.
- An empty result from that channel now carries an error and a code instead
  of `ok:false` with nothing to display.

## [1.4.1]

### Fixed

- A call made in the moment between the Despia Framework locking
  `window.__dsxWire` (at document start) and binding the `window.dsx` module
  bus (a moment later) failed immediately with `no_module`, so an early
  `plans()` or `paywall()` could resolve empty on a perfectly capable app.
  The runtime is correctly identified from the locked wire, so the call layer
  now waits up to two seconds for the bus to bind instead of giving up on the
  first miss. Pages that are not the Framework never wait, since the absence
  of the wire is answered instantly.

## [1.4.0]

### Changed

- Runtime detection no longer requires two signals to agree. The Despia
  Framework module bus and its wire flag are set by the same runtime but not
  necessarily in the same tick, so either one alone now identifies the
  Framework runtime. A Framework app can no longer be misread as the classic
  runtime and sent URL-scheme navigations it does not use.

### Added

- Full native API coverage on both runtimes, so an older binary uses the
  richest read it actually has instead of falling straight through to the
  poorest one:
  - `plans()` and `products()` on the Framework runtime try `catalog`, then
    `offerings`, then the flat `products` action. The middle step keeps
    offering and package placement, which the flat read loses.
  - `plans()` and `products()` on the classic runtime fall back to the legacy
    `revenuecat://offerings` channel when the unified products read is
    absent, so builds that predate it render a paywall instead of an empty
    screen.
  - `status()` and `has()` on the Framework runtime fall back to the
    dedicated `entitlements` action before resorting to store history, which
    reports real RevenueCat entitlement state rather than inferring it.
  - `paywall()` falls back to the legacy `launchPaywall` action spelling on
    builds that predate the current name.

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

[1.4.3]: https://github.com/despia-native/base44-revenuecat/releases/tag/v1.4.3
[1.4.2]: https://github.com/despia-native/base44-revenuecat/releases/tag/v1.4.2
[1.4.1]: https://github.com/despia-native/base44-revenuecat/releases/tag/v1.4.1
[1.4.0]: https://github.com/despia-native/base44-revenuecat/releases/tag/v1.4.0
[1.3.0]: https://github.com/despia-native/base44-revenuecat/releases/tag/v1.3.0
[1.2.0]: https://github.com/despia-native/base44-revenuecat/releases/tag/v1.2.0
[1.1.0]: https://github.com/despia-native/base44-revenuecat/releases/tag/v1.1.0
[1.0.0]: https://github.com/despia-native/base44-revenuecat/releases/tag/v1.0.0
