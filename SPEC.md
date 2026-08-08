# Base44 RevenueCat SDK: Product Specification v2

Status key: **LIVE** = shipped across `base44-revenuecat` 1.1.0, `d-ios`, `d-android`, and `despia-framework`. **P2/P3** = phased native work below.

The product principle stands: if a Base44 user has to learn RevenueCat's native SDK, StoreKit
vs Play Billing, native callbacks, or a subscription mirror table, we failed. Everything
complicated lives below this line:

```js
import revenuecat from 'base44-revenuecat'

await revenuecat.user(user.id)
const plans = await revenuecat.plans()
await revenuecat.buy('monthly')
if (await revenuecat.has('premium')) showPremium()
```

---

## 1. Public API

| Method | Status | Notes |
|---|---|---|
| `user(id)` | **LIVE**: per-call identity + native session bind on current builds | primary name; `login(id)` kept as alias |
| `user()` | **LIVE**: native identity read on current builds, local echo elsewhere | resolves `{ id, user, anonymous, registered }`, see §3 |
| `logout()` | **LIVE**: native `logOut()` on current builds, local clear everywhere | see §3 |
| `plans(offering?)` | **LIVE** | nested plan shape derived from the unified catalog envelope |
| `products(ids?)` / `offers(offering?)` | **LIVE** | flat unified products / full envelope |
| `buy(id, options?)` | **LIVE**; `options.offer` P2 | accepts plan id, kind, `$rc_` package id, or store product id |
| `paywall(offering?)` | **LIVE** | one resolved result per presentation |
| `has(entitlement)` | **LIVE** | CustomerInfo-backed, store-history fallback |
| `info()` / `status()` / `restore()` | **LIVE** | `info()` adds per-entitlement detail |
| `center()` | **LIVE** | Customer Center |
| `redeem()` | **LIVE**: iOS on current builds; Android/browser/old builds resolve `{supported:false}` | Apple offer-code sheet |
| `proof()` | **P3** | signed entitlement token: optional once §6's zero-secret path exists |
| `on('result'|'purchase'|'center'|'user')` | **LIVE** | promise-first; window callbacks never required. `'user'` fans out the identity envelope when a native login/logout settles |

Error model: **never-throw by default**. Every call resolves; failures carry
`{ ok:false, code, error, cancelled }`. Rationale: Base44 apps are largely AI-written; an
unhandled rejection silently kills an async flow, a resolved `ok:false` doesn't. Pros can opt
into exceptions later via a `strict` flag (P2, package-only). Cancellation is never an error
on either model.

## 2. Runtime adapter (LIVE)

Capability detection per call, never exposed to the app:

```
window.__dsxWire + window.dsx.module  → V4: dsx.module.revenuecat.* promises
'despia' user agent                   → V3: revenuecat:// schemes + window channels
neither                               → browser: safe no-op resolutions
```

Per-feature degradation is the law of this package: every native capability is probed with a
timeout and falls back (V3 old build → history-based entitlements; V4 old build → `products`
action mapping). A new package on an old binary must degrade, never hang or throw. New
binaries with old packages keep working because wire formats are only ever extended.

Two rules the classic runtime forces, because an unknown `revenuecat://` command there falls
into a **license-gated catch-all that can raise a native alert**:

1. **Never fire a V3 scheme at an unproven build.** `login`, `logout`, and `redeem` wait for
   the *deferred gate*, an answered envelope (`runtime: 3`) proves the binary carries the
   bridge. Until then they stay local/`unsupported`. V4 has no such hazard (an unknown action
   simply rejects), so probes there are fire-and-forget.
2. **Every method is bound to the module**, so `const { plans, buy } = revenuecat`, the shape
   an AI builder naturally writes, cannot throw on `this`.

## 3. Identity: user / logout / account switch

**What exists natively today (LIVE):** identity rides per-call `external_id`, every
purchase, paywall, center, catalog, and customer call performs an inline RevenueCat
`logIn(external_id)`. `revenuecat.user(id)` stores the id and stamps it on every call, so
**purchase attribution is already correct end-to-end**, and account **switching** is also
correct: RevenueCat explicitly supports `logIn(newId)` directly from another identified user
(no logout in between), which is exactly what per-call identity does.

**The native session bridge (SHIPPED, all three runtimes, one shape):**

| Runtime | Call | Response channel |
|---|---|---|
| V3 iOS/Android | `revenuecat://login?external_id=X` | `window.revenueCatUser` + `onRevenueCatUser(env)` |
| V3 iOS/Android | `revenuecat://logout` | same |
| V3 iOS/Android | `revenuecat://whoami` (read-only, no logIn) | same |
| V4 module | `login({external_id})` / `logout()` action | resolves the same envelope (+ mirrors the window channel) |
| V4 module | `whoami()` action | resolves detailed customer info + mirrors the same envelope |

Envelope: `{ ok, user, anonymous, registered, new, entitlements:{active,all}, platform, runtime,
bridge, error, code }` (`new` = RevenueCat `created`; `registered` = `!anonymous`; `user` is the
raw RC app user id, anonymous `$RCAnonymousID:` ids included). Native `login` merges anonymous
history at sign-in; native `logout` calls `Purchases.logOut()`, rotating to a fresh anonymous
user so a shared device never shows the previous account's entitlements (an already-anonymous
logout resolves as success, that state IS the goal). Rollout mechanics in the package (LIVE):
on V4 the probe is fire-and-forget (older modules ignore it); on V3 the schemes fire only after
an envelope has **proven** the build carries the bridge, the deferred bind, so old binaries
never see a stray prompt. **No package update is needed as builds roll out.**

**The capability stamp + RC-anonymous purchases (SHIPPED, all three runtimes):** every
envelope now carries `bridge: 2`, meaning the build supports (a) the `whoami` identity read
and (b) purchases/paywalls **without** `external_id`, which then attach to RevenueCat's own
current (possibly anonymous) user, RC's anonymous-first best practice, merged later by
`login`. Package ladder when nobody is bound:

| Build | `buy()` / `paywall()` identity |
|---|---|
| V4 current | no `external_id`; a `missing_param` rejection (old module) triggers ONE legacy retry with the synthesized `b44_` id |
| V3 `bridge >= 2` | no `external_id` |
| V3 proven, no stamp | synthesized stable `b44_` id (those builds hard-require it) |
| unproven V3 / browser | synthesized id / safe no-op (unchanged) |

`user()` with no argument reads identity natively (V4 `whoami` action; V3 `whoami` scheme,
gated on `bridge >= 2` because old catch-alls treat unknown actions as purchases) and
resolves `{ id, user, anonymous, registered }`; a registered id the SDK persisted across
restarts is adopted into the package state so later calls keep naming the same customer.

Interim guidance (README, LIVE): apps with accounts gate on both:
`const premium = user && await revenuecat.has('premium')`, which is correct on every build
ever shipped, before and after P2.

## 4. Live store metadata (LIVE): this already shipped

The mandatory requirement is done: `revenuecat://products` (V3 iOS + Android) and the
`catalog` action (V4, mirrored to the same window channel) return the **unified envelope**
with real device-store data from `getOfferings()` → StoreProduct: localized `priceString`,
`currency`, decimal `price`, ISO-8601 `period` + unit/count, `intro` (free trial / intro
phase), title, description, offering/package placement, identical JSON on iOS, Android, V3,
V4 (`runtime` field tells them apart). Never hardcode a price; never build a currency string.

`plans()` is a **package-side view** over that envelope, the wire format stays flat and
stable across three native codebases; the pretty nested shape is computed in JS:

```
plan.id      packageType when unique ('monthly'), else the package id minus '$rc_', else product id
plan.rcId    '$rc_monthly'        plan.product  the store product id (feeds buy())
plan.kind    weekly|monthly|annual|lifetime|custom
plan.price   { value, text, currency }         ← text is ALWAYS the display value
plan.period  { iso, value, unit }
plan.trial   { days, eligible }   from intro.type === 'trial'
plan.intro   { type:'payg'|'upfront', eligible, price, period, cycles }
plan.offers  []                   ← filled by P2 (§5)
```

Principle: **presentation lives in the adapter, truth lives on the wire.** Changing a JSON
nicety costs one npm patch, not three native releases.

## 5. Trials, introductory offers, discounts, promo offers

**How it works today (LIVE):**

- **Free trials & intro offers apply automatically at purchase.** On iOS the App Store
  auto-applies the introductory offer when the customer is eligible; on Android the bridge
  purchases RevenueCat's default option, which prefers the longest eligible free trial, then
  the cheapest intro phase, then base price. `buy('monthly')` therefore already gets the
  trial with zero developer logic, eligibility is enforced by the store even where we can't
  yet report it.
- The envelope's `intro` field carries the phase for display: `{price, priceString, period,
  periodUnit, periodCount, cycles, type:'trial'|'intro'}` (iOS: `introductoryDiscount`;
  Android: default option `freePhase`/`introPhase`).
- `plans()` renders that as `trial: {days, eligible}` / `intro: {type:'payg'|'upfront',…}`.
  `eligible` is `null` today = "unknown here, the store decides at purchase" (honest, and
  safe to render as available).

**P2 native additions:**

1. **iOS eligibility**: `checkTrialOrIntroDiscountEligibility` behind the catalog fetch so
   `trial.eligible`/`intro.eligible` become real booleans for the signed-in Apple account
   (iOS-only API; Android eligibility is implied by which options Billing returns).
2. **`intro.mode`**: emit Apple's paymentMode natively (`free|payg|upfront`) instead of the
   current cycles-heuristic in `plans()`.
3. **Google multi-offer normalization**: beyond the default option, emit every
   `subscriptionOption` as `offers: [{ id, type:'trial'|'intro'|'promo', eligible, tags,
   phases:[{type:'free'|'discount'|'normal', price, period, cycles}] }]` on the product.
   Same array on iOS from promotional offers (`StoreProductDiscount`, type `'promo'`).
4. **Explicit offer purchase**: `buy(id, {offer})`:
   - wire: V3 `revenuecat://purchase?...&offer=<id>`, V4 `purchase({..., offer})`:
     **LIVE**: the package already forwards `options.offer`; old natives ignore the
     parameter, so this is forward-compatible today.
   - Android P2: select the matching SubscriptionOption / Google `offerId` and purchase it.
   - iOS P2: promotional offers are **not** auto-applied, the bridge must fetch the signed
     offer via RevenueCat (`Purchases.promotionalOffer(forProductDiscount:product:)`) and
     purchase with it. Failure surfaces as `code:'offer_not_available'`; the package retries
     without the offer only if `options.fallback !== false`.
5. **Developer-determined Google offers**: documented rule: tag manual-only offers
   `rc-ignore-offer` in Play/RevenueCat so RevenueCat's automatic selection never turns a
   win-back discount into the acquisition price; trigger them with `buy(id, {offer})`.
6. **Offer codes**: `redeem()`: iOS presents Apple's offer-code redemption sheet
   (`presentCodeRedemptionSheet`, iOS 14+; note: does not work in sandbox); Android resolves
   `{supported:false}` (Play has no in-app equivalent). Package stub is LIVE and starts
   working the moment builds carry the bridge. Wire: V3 `revenuecat://redeem`, V4 `redeem`
   action, response on the result channel (`source:'redeem'`).
7. **RevenueCat Paywalls already cover most of this**: paywalls render configured
   trials/intro offers themselves, and current RevenueCatUI supports attaching promotional
   offers to paywall packages. `paywall()` is the zero-code path; `plans()`+`buy()` is the
   custom-paywall path. Both LIVE.

## 6. Server-side verification: the friction ladder

Client checks gate UI; server checks gate value. Three rungs, lowest friction first:

1. **LIVE, zero-secret (new, replaces "secret required" as the default):** RevenueCat's v1
   `GET /subscribers/{app_user_id}` accepts the **public** SDK key. A Base44 backend function
   verifies with a value that is public by definition, no secrets manager step:

   ```js
   import { entitled } from 'npm:base44-revenuecat/server'
   const user = await base44.auth.me()                      // server-verified identity
   const ok = await entitled(user.id, 'premium', { key: 'appl_XXXX' })  // public SDK key
   ```

   The key must be *configured server-side* (pasted constant or env `RC_KEY`), never read
   from the request, accepting a client-sent key would let an attacker point the check at a
   different RevenueCat app. Note: v1 public-key reads are also how the mobile SDKs fetch
   CustomerInfo; verify field coverage against current RC docs at GA.
2. **LIVE, secret key (optional upgrade):** `{ secret }` / env `RC_SECRET` unlocks the v2
   API path (project-scoped, lookup-key join, higher rate limits, future v2-only features).
3. **P3, `proof()` signed tokens:** Despia's backend signs a short-lived
   `{app, user, active, iat, exp}` and `base44-revenuecat/server` verifies the signature +
   expiry + that `proof.user === base44.auth.me().id`. Zero RevenueCat traffic from Base44
   functions and zero config, but it stands up signing infra, key distribution, and an
   availability dependency. Build it for scale/offline-tolerance *after* rungs 1 and 2 prove the
   DX, not before. (The dev draft made this the centerpiece; rung 1 removes its urgency.)

Never at any rung: webhooks, subscription mirror tables, receipt parsing. RevenueCat is the
source of truth and is asked at decision time.

## 7. Unified native contract (what each repo exposes)

LIVE today, one JSON on all runtimes (`runtime: 3|4` distinguishes):

| Capability | V3 (d-ios / d-android) | V4 (Core/RevenueCat module) |
|---|---|---|
| Catalog | `revenuecat://products` → `revenueCatProducts` + `onRevenueCatProducts` | `catalog` (resolves + mirrors same channel); `products` no-ids also mirrors |
| Customer/entitlements | `revenuecat://customer` → `revenueCatCustomer` + `onRevenueCatCustomer` | `customer` (resolves + mirrors) |
| Purchase / paywall outcomes | `revenueCatResult` + `onRevenueCatResult`, exactly one per attempt/presentation (purchased·restored·cancelled·error) | same channel, same rule (paywall delegate on iOS, PaywallResult on Android) |
| History/restore | `getpurchasehistory://` → `restoredData` | `history` (also writes `restoredData`) |
| Paywall / Center / Purchase | `revenuecat://launchPaywall|center|purchase` (`external_id` optional on bridge 2) | `paywall|center|purchase` actions (`external_id` optional) |
| Identity read | `revenuecat://whoami` → `revenueCatUser` + `onRevenueCatUser` | `whoami` (resolves detail + mirrors the same channel) |

P2 additions (all three runtimes, additive only, `contract_diff` compatible):
`login` / `logout` / `whoami` (§3), the `bridge: 2` capability stamp + `registered` on every
envelope + optional `external_id` with the RC-anonymous fallback (§3), `redeem` (§5.6),
`offer` param on purchase (§5.4), `offers[]` + `intro.mode` + `eligible` in the catalog
envelope (§5.1 to 5.3), per-entitlement detail (`period: normal|trial|intro|promo`, product,
expiry) in the customer envelope, V4's entitlement mapper already carries `period_type`; V3
lifts the same fields from CustomerInfo. Existing envelope fields are never renamed or
removed; consumers must tolerate unknown fields (both LIVE package adapters already do).

## 8. Rollout phases

- **P1 (done, this branch):** unified catalog/customer/result contract on V3+V4, the npm
  package (runtime adapter, plans/buy/paywall/has/info/restore/center/events, old-build
  fallbacks), zero-secret + secret server verification, SEO README.
- **P2a (done):** login/logout session bridge on all three runtimes · `redeem` bridge
  (iOS sheet; Android settles `unsupported`) · package deferred-bind rollout mechanics ·
  `whoami` identity read + `bridge: 2` capability stamp + optional `external_id` with the
  RevenueCat-anonymous purchase fallback on all three runtimes · package `user()` native
  read + `registered` + synthesized-id retirement on capable builds.
- **P2b (native, next):** iOS intro/trial eligibility + `intro.mode` · Google `offers[]`
  normalization + offer-targeted purchase · iOS signed promotional-offer purchase ·
  entitlement detail in the customer envelope. Ships runtime-by-runtime; the LIVE package
  auto-upgrades via capability probes.
- **P3 (infra, optional):** `proof()` signed entitlement tokens + Despia-side verification
  endpoint; package `strict` mode; Base44 marketplace listing/template.

## 9. Test matrix

LIVE in `test.js` (simulated runtimes): browser no-op · V3 full flow · V3 old build
(fallback) · V3 bridge-2 build (native whoami + RC-anonymous purchases) · V3 legacy-anon
(synthesized id kept) · V4 full flow · V4 old build (fallback) · V4 identity
(whoami/adoption/anonymous buy) · V4 legacy retry (missing_param → one synthesized-id
retry), plus empty-history prompt-resolution (the classic observer pitfall) and paywall
result-channel racing.

Release matrix on devices (per release): {V3 iOS, V3 Android, V4 iOS, V4 Android} ×
{anonymous, identified, login, account switch, logout, trial, intro (payg/upfront), regular
+ annual sub, consumable, non-consumable, restore, cancelled purchase, active + expired
entitlement, RC paywall, localized currency, iOS promo offer, Google offer, offer code,
offline cached CustomerInfo, old-binary/new-package, new-binary/old-package}. One public-API
behavior difference between runtimes = adapter bug by definition.
