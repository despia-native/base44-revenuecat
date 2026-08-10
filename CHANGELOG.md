# Changelog

All notable changes to `base44-revenuecat` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every release keeps the same promise: no client call ever throws, and a newer
package on an older Despia build degrades instead of breaking. Native
capabilities are probed at runtime, so you never version-match JavaScript
against a compiled binary. (The `/server` helpers throw by design, so backend
gates fail closed.)

## [1.6.0] - 2026-08-10

### Fixed

- **A `customer` envelope with no entitlement data no longer masks the store
  history.** A build whose customer action answered with an empty object made
  a live subscriber read as not entitled; such an envelope now falls through
  to the entitlements read / device history, the same guard the entitlements
  action already had. Applies to both runtimes, and the envelope's metadata
  (active subscriptions, the manage deep link, the identity it named) still
  rides along on the fallback answer instead of being blanked.
- **Synchronous native answers can no longer be lost.** Every classic-runtime
  call now registers its response channel *before* firing the scheme (only
  `paywall()` did previously); a native layer that answered in the same tick
  had its answer deleted by the listener setup and the call waited for the
  full timeout.
- **Any identity change invalidates the cached catalog.** `user(newId)` now
  clears the plan cache like `logout()` always did — and so does identity
  adoption, when `user()` with no arguments picks up a login the native SDK
  persisted — so targeted offerings can never price one user off another
  user's catalog.
- **The unsubscribe function returned by `on()` no longer leaks.** It now
  releases the package's own bookkeeping too (previously only `off()` did),
  so subscribe/unsubscribe cycles no longer grow memory.
- **`center()` reports failure honestly.** A build without Customer Center
  now resolves `{ ok: false, code: 'unsupported' }` immediately instead of
  hanging for the full window and then resolving `ok: true`; the timeout case
  now resolves `ok: false, code: 'timeout'`. On the classic runtime it now
  waits for bridge proof like `redeem()` and `whoami` (unproven old builds
  route unknown schemes into a catch-all that can raise a native alert), and
  an ambiguous presentation-ack failure keeps waiting for the real dismissal
  instead of settling early.
- **Unknown intro prices stay unknown.** The legacy offerings channel reports
  no numeric intro price; `plans()` now preserves `price.value: null` for it
  instead of coercing to `0` (types updated accordingly) — so an unknown
  price can never render as "$0.00".
- **`buy(object)` with no usable id fails fast** with `missing_param` instead
  of sending the string "[object Object]" to the store.
- **Types match runtime for CommonJS consumers.** The main entry's
  declaration now uses `export =` (the CJS export is the revenuecat object
  itself, not `{ default }`), and the `/server` entry ships split
  `server.d.mts` / `server.d.cts` so `require('base44-revenuecat/server')`
  no longer typechecks a `.default` that is `undefined` at runtime.
  `server.d.ts` remains as a named-exports-only fallback so legacy
  `moduleResolution: "node"` consumers keep resolving.

### Added

- **Server: per-request timeout.** RevenueCat calls abort after 10 s by
  default (`{ timeout: ms }` to change), so a hung connection can no longer
  hang a Base44 backend function.
- **Server: honest v2 fallback.** Only a v2 key/project mismatch (401/403/404)
  falls back to v1 — and the verdict is remembered, so a misconfigured v2
  setup no longer doubles every call's latency. Rate limits (429) and server
  errors now surface to the caller (with `.status` on the error) instead of
  silently spending a second request. A 404 on the customer read is
  disambiguated through the (cached) project entitlements list, so a wrong
  project id falls back to v1 instead of silently denying every subscriber.
- **Server: v2 entitlement pagination** now follows `next_page` on the
  active-entitlements read as well.
- `ErrorCode` union type and documented error-code vocabulary; README gained
  Error handling, `info()`, `ready()`, `offers()`, `redeem()` and `off()`
  sections; server docs now state the create-on-read behavior of RevenueCat's
  v1 subscriber endpoint and every configuration option.
- `package.json`: `engines.node >= 18`, `./package.json` export, provenance
  on publish; removed the incorrect `module` field (the main entry is UMD/CJS,
  not ESM). `prepublishOnly` now runs the full suite, the consumer-fixture
  type checks (node16 and legacy node10 resolution), and publint.

### Compatibility

- `center()` callers that treated `ok: true, code: 'timeout'` as success
  should branch on `code`; every other change is behavior users already
  expected. `Plan.price.value` is now typed `number | null` (it was already
  null-shaped at runtime on modern builds for legacy intro offers — the
  runtime previously masked it as `0`).

## [1.5.0] - 2026-08-08

### Added

- `info()` now reports real per-entitlement lifecycle state on builds that
  provide it, instead of inferring what it can from the device's store
  history. Each entitlement gains `unsubscribed` (set when the user turned
  auto-renew off while still inside the paid period, which is the window
  where a win-back offer is worth showing), `billingIssue` (set while the
  store retries a failed payment), `store`, `ownership`, and `sandbox`, and
  `period` now reports the real billing phase. This is the difference between
  knowing someone is entitled and knowing they are entitled but leaving.
- `status()` carries the raw `details` map through for callers that want it
  unshaped.

### Compatibility

- Builds that predate lifecycle state fall through to the previous
  history-based inference, so `info()` answers the same shape everywhere and
  nothing regresses. The new per-entitlement fields are optional in the types
  for exactly that reason.

## [1.4.3] - 2026-08-08

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

## [1.4.2] - 2026-08-08

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

## [1.4.1] - 2026-08-08

### Fixed

- A call made in the moment between the Despia Framework locking
  `window.__dsxWire` (at document start) and binding the `window.dsx` module
  bus (a moment later) failed immediately with `no_module`, so an early
  `plans()` or `paywall()` could resolve empty on a perfectly capable app.
  The runtime is correctly identified from the locked wire, so the call layer
  now waits up to two seconds for the bus to bind instead of giving up on the
  first miss. Pages that are not the Framework never wait, since the absence
  of the wire is answered instantly.

## [1.4.0] - 2026-08-08

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

## [1.3.0] - 2026-08-08

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

## [1.2.0] - 2026-08-07

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

## [1.1.0] - 2026-08-07

### Added

- `plans()` returns subscription plans shaped for rendering a paywall
  screen, with nested price, period, trial, and introductory offer detail
  derived from the live store catalog.
- `user(id)` / `logout()` identity handling and `info()` for a normalized
  per-entitlement view of the customer.
- Zero-secret server verification: `base44-revenuecat/server` accepts a
  RevenueCat public SDK key for entitlement checks, with the secret-key v2
  path available when you want it.

## [1.0.0] - 2026-08-07

### Added

- First release. Promise-based RevenueCat in-app purchases and
  subscriptions for Base44 apps shipped as native iOS and Android apps with
  Despia: `products()`, `buy()`, `paywall()`, `has()`, `status()`,
  `restore()`, `center()`, and event subscriptions, over one unified JSON
  contract shared by both Despia runtimes, with safe no-op resolutions in a
  plain browser.

