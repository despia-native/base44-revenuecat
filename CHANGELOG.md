# Changelog

All notable changes to `base44-revenuecat` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Every release keeps the same promise: no client call ever throws, and a newer
package on an older Despia build degrades instead of breaking. Native
capabilities are probed at runtime, so you never version-match JavaScript
against a compiled binary. (The `/server` helpers throw by design, so backend
gates fail closed.)

## [1.6.1] - 2026-08-11

### Fixed

- **Ships the money-critical and server hardening that landed on main after
  `1.6.0` was published** (PRs #11–#15): `plans()` no longer mixes offerings
  so a promo price can be shown and a full price charged; catalog cache is
  scoped so short ids cannot be repointed between render and purchase;
  server sandbox checks use the v1 path that actually supports
  `X-Is-Sandbox`; a v2 "nothing active" answer is confirmed against v1 before
  denying a customer; SSRF pinning, grace-period math, and the CI pack/install
  gate that let a broken tarball ship are fixed. Full write-up of each item is
  under the Fixed sections below (changelog on main was updated before this
  version bump).

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
  requires bridge proof like `redeem()` and `whoami` (unproven old builds
  route unknown schemes into a catch-all that can raise a native alert) —
  proving it with the catalog read when nothing else has run yet, so an
  account screen that calls `center()` first still opens on a capable build.
  An ambiguous presentation-ack failure keeps waiting for the real dismissal
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

### Fixed (RevenueCat REST API contract)

- **The two API paths could disagree against a paying customer, and now
  cannot.** v2's rules for grace periods and other still-granting states are
  undocumented, and its `active_entitlements` has been observed returning
  nothing for a customer v1 reports as entitled. Rather than leave that as a
  known seam, a "nothing active" answer from v2 is now confirmed against v1
  before it is reported. Granting wrongly costs a little revenue; denying a
  paying customer costs the customer. The extra request is spent **only** when
  v2 reports nothing for a customer it knows — a positive answer and an
  unknown customer both cost nothing extra, and an unknown customer is not
  looked up in v1 at all, so no phantom customer records are created.
  `{ confirmDenials: false }` opts out.

- **`{ sandbox: true }` silently did nothing on the secret-key path.**
  `X-Is-Sandbox` is a **v1** header; the v2 API has no documented sandbox
  support, and its `active_entitlements` has been reported empty for a
  customer v1 reports as entitled from a sandbox purchase. Anyone testing
  with `RC_SECRET` + `RC_PROJECT` set would have had every sandbox purchase
  denied with no way to fix it. A sandbox check now always uses the v1 path,
  where sandbox is defined; production checks are unaffected. The header is
  also no longer sent to v2 endpoints at all.
- **`Retry-After` was discarded on rate limits.** RevenueCat sends it with a
  429; the thrown error now carries `retryAfter` in seconds alongside
  `status`, so a caller can back off for the interval the API asked for
  instead of guessing.

### Changed (test and release gates)

- **CI verified the working tree, not the package it publishes.** The
  "package contents resolve" step required files from the git checkout, so it
  passed even when a file was missing from `package.json` "files" — dropping
  `server.d.ts` and `server.js` left `npm test`, the resolve step, the type
  fixtures and publint all green while the published tarball gave consumers
  `MODULE_NOT_FOUND`. That is the exact regression the node10 fixture was
  written to prevent. CI now packs the tarball, installs it into a clean
  directory, and resolves every entry point from there.
- **The suite now kills every mutation in a 29-case money-critical sweep**
  (it started at 14/29). Deliberately breaking plan-id disambiguation, the
  `$rc_` prefix strip, period defaults, the store-confirmed product id, the
  billing-period map, offer forwarding on both runtimes, native logout,
  active-only history filtering, entitlement de-duplication, the empty-details
  guard, the v2 downgrade cache key, pagination depth, project-id encoding,
  the lifetime-grant guard, grace-period math, sandbox headers, SSRF pinning
  and epoch-unit handling now each fail the suite.
- **A late async failure can no longer be swallowed.** The runner exited
  immediately on success, so a rejection landing after the last scenario was
  truncated and reported green; unhandled rejections and exceptions now fail
  the run. Wall-clock assertions were also given headroom so a loaded CI
  runner cannot flake a correctness gate.
- **The suite was mutation-tested and hardened.** Deliberately breaking
  money-critical code proved the green suite would not have noticed a build
  that charged the wrong SKU, kept lapsed subscribers entitled, read the wrong
  user's subscription server-side, showed a $0.00 price, or resolved a
  purchase with a paywall's outcome. Every one of those now fails the suite:
  new scenarios cover server identity and exact entitlement matching, lapsed
  entitlements on both `info()` paths, plan resolution by name, price and
  currency through the RC-flavored mapper, shared-result-channel isolation
  under a stray outcome, anonymous-id stability, and event delivery.

### Fixed (money-critical)

- **`plans()` mixed every offering in the project, so a promo price could be
  shown and a full price charged.** It flattened all offerings instead of
  describing one, letting a non-current offering's package claim the canonical
  short id (`monthly`) that the README tells you to pass to `buy()`. In a
  project with a second offering — an experiment, a win-back, a legacy price,
  which is RevenueCat's normal state — `buy(plans[0].id)` charged that
  offering's SKU, and the current offering's plan lost its short id. `plans()`
  now describes exactly one offering: the filtered one when you pass an id,
  otherwise the current one.
- **An unrelated catalog read could repoint a short id at a different SKU
  between render and purchase.** The plan cache was a single unscoped slot, so
  a prefetch or another screen calling `products()` after you rendered
  `plans('winback')` made `buy('monthly')` resolve against the full catalog —
  the user saw one price and was charged another. The cache is now keyed by
  offering scope, and a bare `buy()` resolves against the scope `plans()` last
  rendered. Catalog reads deliberately do not move that scope: you are charged
  what you were shown.
- **`status()` could report "not entitled" for a subscriber `restore()` could
  see.** The two calls gave the same native store-history read different
  budgets (8 s vs 15 s), so on a slow cold start the documented gate denied a
  paying customer while the restore button worked. Both now use the same
  budget.
- **`center()` could hang for 30 minutes on a terminal error.** Only four error
  codes settled it; every other code the native module can return — including
  `not_ready`, which is likely when a "Manage subscription" tap happens early
  in launch — fell through to the sheet timeout. Now only an ambiguous
  presentation-ack timeout keeps waiting; everything else settles immediately.
- **`redeem()` answered `unsupported` on a cold first call** on builds that do
  support it, because it required bridge proof without probing for it. It now
  probes the same way `center()` does — relevant since "Have a code?" is often
  the first RevenueCat call an app makes.
- **A zero-entitlement customer envelope still outranked store history.**
  Current builds always set `details`, and `{}` is truthy, so the guard added
  in 1.6.0 never fired on them. It now checks for actual content.

### Fixed (documentation)

- **`buy(id, { offer })` was documented as working. It is not implemented
  natively.** Verified against the Despia Framework runtime source: the V4
  RevenueCat module's `purchase` action declares only `external_id` and
  `product`, and neither the Swift nor the Kotlin bridge reads an offer
  parameter, so the forwarded id is silently ignored and the store applies
  its default offer logic. The README now documents offering-based targeting
  (`paywall('winback')` / `plans('winback')` driven by
  `info().entitlements.<id>.unsubscribed`) as the way to target a price
  today, and `BuyOptions.offer` is marked deprecated in the types. The option
  is still accepted and still forwarded, so nothing breaks when the native
  side ships it.
- **`plan.offers` was documented as "filled by newer builds". It is always
  empty.** Neither native bridge emits a per-product offer list, so the array
  is reserved, not conditionally populated. Same correction for
  `trial.eligible` / `intro.eligible`, which are always `null` — the store
  enforces eligibility at purchase, so that is by design rather than a gap to
  work around.
- **Android paywall purchases resolve `product` and `transaction` as `null`**
  (the native paywall result exposes only customer info). Documented, with
  the guidance to branch on `ok`/`cancelled`/`entitlements` instead.
- **A misspelled offering id silently shows your default offering.** Both
  native bridges fall back to the default offering when `paywall(id)` names
  an offering that does not exist, so a full-price paywall appears where a
  discount was intended. Now documented, along with the deliberate contrast:
  `plans(id)` / `offers(id)` answer `offeringNotFoundError` instead of
  widening to the full catalog.

### Added

- **Server: sandbox purchases can be verified.** RevenueCat's API answers
  with PRODUCTION purchases only, so a Sandbox Apple ID / Play license-tester
  purchase was invisible to `entitled()` while the device could see it — the
  client said entitled and the server said not, all through sandbox testing.
  Pass `{ sandbox: true }` (or set `RC_SANDBOX=true`) to send RevenueCat's
  `X-Is-Sandbox` header; production calls never carry it. The README's Testing
  section previously claimed the server check saw sandbox purchases, which was
  wrong, and Troubleshooting now names this as the first thing to check when
  the two sides disagree.
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
- **Server: a newly created entitlement is no longer denied.** The v2
  entitlement-id to lookup-key map is cached ~5 minutes; an id missing from
  it (an entitlement created since) used to surface as the raw `entl...` id
  and fail the gate. A miss now refreshes the map once.
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

