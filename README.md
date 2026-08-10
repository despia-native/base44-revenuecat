# Base44 In-App Purchases & Subscriptions: RevenueCat for Base44 iOS and Android apps

**Sell real App Store and Google Play subscriptions from your Base44 app.** This package connects a Base44 app, published as a native iOS and Android app with [Despia](https://despia.com), to Apple StoreKit and Google Play Billing through the RevenueCat SDK that Despia compiles into your binary. Query products with live store pricing, launch native paywalls, run purchases, check entitlements, and verify subscribers server-side in Base44 backend functions. Promise-based, three-letter-simple, zero native code, zero webhooks.

[![on npm](https://img.shields.io/npm/v/base44-revenuecat)](https://www.npmjs.com/package/base44-revenuecat) · [![tests passing](https://img.shields.io/github/actions/workflow/status/despia-native/base44-revenuecat/test.yml?branch=main&label=tests)](https://github.com/despia-native/base44-revenuecat/actions/workflows/test.yml) · [![TypeScript types](https://img.shields.io/npm/types/base44-revenuecat)](https://github.com/despia-native/base44-revenuecat/blob/main/index.d.ts) · [![Apache-2.0 licensed](https://img.shields.io/npm/l/base44-revenuecat)](https://github.com/despia-native/base44-revenuecat/blob/main/LICENSE) · [![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://github.com/despia-native/base44-revenuecat/blob/main/package.json)

For Base44 makers shipping a real iOS and Android app: monthly and annual subscriptions,
one-time unlocks, consumable credits, free trials and introductory offers, all billed by
Apple and Google so your app passes review.

```bash
npm install base44-revenuecat
```

```javascript
import revenuecat from 'base44-revenuecat'

await revenuecat.user(user.id)            // your Base44 user id = your RevenueCat customer id

const plans = await revenuecat.plans()    // live App Store / Google Play prices, trials, intro offers
await revenuecat.buy('monthly')           // native purchase sheet, trial applies automatically

await revenuecat.paywall()                // or: the RevenueCat paywall you designed in its dashboard

if (await revenuecat.has('premium')) unlockPremium()   // client-side entitlement gate
```

> **`premium` is a placeholder for your own entitlement id, not a built-in.** RevenueCat ships no default entitlements, so nothing called `premium` exists until you create it yourself in the RevenueCat dashboard (Product catalog → Entitlements) and attach your App Store and Play Store products to it. Use **your** id everywhere this README writes `premium`. Until that entitlement exists and has products attached, `has('premium')` stays false for every user forever, including immediately after a real purchase that Apple or Google actually charged for. New to this? Read **[the entitlements guide](ENTITLEMENTS.md)** first: what they are, how to create one, how to attach subscriptions and one-time purchases, and why credit packs work differently.

Every **client** call returns a promise and **never throws**. In the Base44 browser preview each method resolves a safe empty result, so you can build and preview your paywall logic on the web and it simply comes alive inside the installed app. (The [server helpers](#verify-on-the-server-base44-backend-function-no-webhooks-no-secrets) are the one deliberate exception: they throw on failure so your backend fails closed — see [Error handling](#error-handling).)

**Requirements:** the client runs anywhere Base44 runs (it's dependency-free UMD). The `/server` entry needs a runtime with global `fetch`: Base44 backend functions (Deno) work as-is, Node needs **Node 18+**.

---

## Why this exists

Base44 builds your web app. [Despia](https://despia.com) turns that Base44 app into a **real native iOS and Android app** you ship to the App Store and Google Play, with push notifications, native UI, and (via this package) **real in-app purchases and auto-renewing subscriptions**. Apple and Google require digital goods to go through StoreKit / Play Billing, so a Stripe checkout in a WebView will get your app rejected; this is the compliant path, and RevenueCat keeps both stores in sync for you.

You do **not** need webhooks, a subscriptions table, or native code. The two questions that matter are answered directly:

- *What should the app show this user?* → `revenuecat.has('premium')` on the device.
- *Should the server run this paid action?* → `entitled(user.id, 'premium')` in a Base44 backend function.

---

## Setup (one time, ~15 minutes, no code)

### Part 1: RevenueCat

1. Create a free account at [app.revenuecat.com](https://app.revenuecat.com) (free until well past your first revenue).
2. **Project settings → Apps → + New → App Store**: enter your iOS bundle id, upload an App Store Connect API key (App Manager role) and an In-App Purchase key.
3. **Project settings → Apps → + New → Play Store**: enter the same package name and upload your Google Play service-account JSON.
4. **Product catalog → Entitlements → + New**: create one entitlement per thing you unlock, e.g. `premium`. Attach your App Store and Play Store products to it (both stores → one entitlement id, so your app code never branches per platform). **The id you type here is the literal string you pass to `has()` and `entitled()` later**, so choose it deliberately and copy it exactly. `premium` is only this README's example, and an entitlement you never created can never turn true. Attaching products, tiers, lifetime unlocks and consumables are all covered in [the entitlements guide](ENTITLEMENTS.md).
5. **Product catalog → Offerings**: group products into an offering (the `default` offering is what paywalls show), e.g. a monthly and an annual package.
6. Optional but recommended: design your paywall in **Paywalls**. `revenuecat.paywall()` presents it natively, priced in each user's own currency, and you can restyle it from the dashboard without an app update.
7. **Project settings → API keys**: copy the **iOS public SDK key** (`appl_…`), the **Android public SDK key** (`goog_…`), and note your **project id** (`proj…`, shown in Project settings / the dashboard URL).

### Part 2: Despia (the only step that touches your app)

Open **Despia → Your App → Settings → Integrations → RevenueCat** and paste:

| Field | Value |
|---|---|
| iOS key | your `appl_…` public SDK key |
| Android key | your `goog_…` public SDK key |
| Global project ID | your `proj…` project id |

Then **trigger a new build**. The RevenueCat SDK is compiled into the binary, so integration changes always need a rebuild. Until then purchases stay dormant.

That's the entire native setup. Everything else is the JavaScript below, written inside your Base44 app.

---

## API

Small names, promises everywhere, identical behavior on iOS and Android.

### `revenuecat.user(id)`: connect Base44 users to RevenueCat customers

```javascript
// Use your Base44 user's stable database id as the RevenueCat customer id.
// The SAME id is what your backend verifies later. One id everywhere.
const me = await base44.auth.me()
await revenuecat.user(me.id)
```

Call it once when your app knows who the user is (after Base44 auth), before showing a paywall. Use the stable id, not an email, name, or phone number. Before `user()`, purchases run under RevenueCat's own anonymous user (exactly how RevenueCat recommends it) and the anonymous history merges on first identify. (`revenuecat.login(id)` is an alias.)

**Who is logged in right now?** Call `user()` with no arguments. On current builds it asks the native RevenueCat SDK directly, so it works even before your code binds anyone:

```javascript
const who = await revenuecat.user()
// { id: '$RCAnonymousID:abc...',  user: null,  anonymous: true,  registered: false }
// { id: 'base44_user_42',         user: 'base44_user_42', anonymous: false, registered: true }

if (!who.registered) await revenuecat.user(me.id)   // bind the account once
```

`id` is always the real RevenueCat app user id (anonymous ids included), `user` is the account id you bound (null when anonymous), and `registered` answers "is this RevenueCat user logged in?" in one boolean. A login the native SDK remembered from a previous session is picked up automatically.

**Switching accounts** is just another `user(newId)`, with no logout in between; RevenueCat supports identifying straight from one user to the next:

```javascript
await revenuecat.user(otherAccount.id)   // switch. Entitlements now reflect the new user
```

**Logging out** of your app:

```javascript
await revenuecat.logout()
await base44.auth.logout()
```

On current builds `logout()` also asks the native layer to rotate to a fresh anonymous RevenueCat user where supported. Apps with accounts should gate premium on both signals, which is correct on every build ever shipped:

```javascript
const premium = user && await revenuecat.has('premium')
```

### `revenuecat.plans()`: build your subscription paywall screen

```javascript
const plans = await revenuecat.plans()          // the current RevenueCat offering
// or: await revenuecat.plans('summer_sale')    // a specific offering

plans.forEach(plan => renderPlan({
  name:  plan.title,
  price: plan.price.text,                       // "AED 39.99", localized by the store
  trial: plan.trial                             // { days: 7, eligible } or null
}))

await revenuecat.buy(plans[0].id)               // 'monthly' / 'annual', plan ids work in buy()
```

Each plan is the same JSON on iOS and Android:

```javascript
{
  id: 'monthly',                 // stable short id, feeds buy()
  rcId: '$rc_monthly',           // RevenueCat package
  product: 'premium_monthly',    // underlying store product id
  type: 'subscription',
  kind: 'monthly',               // weekly | monthly | annual | lifetime | custom
  title: 'Premium Monthly',
  desc: 'Full premium access',
  price:  { value: 39.99, text: 'AED 39.99', currency: 'AED' },
  period: { iso: 'P1M', value: 1, unit: 'month' },
  trial:  { days: 7, eligible: null },   // free trial, when configured (eligible: null = the store decides at purchase)
  intro:  null,                          // or { type: 'payg'|'upfront', eligible, price, period, cycles }
  offers: []                             // normalized store offers (newer builds)
}
```

`price.text` is **always** the value to display. Never construct a currency string yourself, and never hardcode a price. On legacy classic-runtime builds an intro offer's numeric `price.value` can be `null` (the channel only reports the display string) — render `price.text` and never treat null as 0.

### `revenuecat.products()`: App Store / Google Play products with live pricing

```javascript
const products = await revenuecat.products()          // every product across your offerings
const monthly  = await revenuecat.products('default') // or just one offering

/* Each product is the SAME JSON on iOS and Android:
{
  id: "premium:monthly",        // pass straight to revenuecat.buy()
  sku: "premium",               // raw store product id (Android: without the base-plan suffix)
  plan: "monthly",              // Android base plan id; null on iOS and for one-time products
  type: "subscription",         // or "product" for one-time purchases
  title: "Premium Monthly",
  desc: "Unlimited everything",
  price: 9.99,                  // decimal, user's local currency
  priceString: "$9.99",         // localized by the store, render this
  currency: "USD",
  period: "P1M",                // ISO-8601: monthly
  periodUnit: "month",
  periodCount: 1,
  intro: {                      // free trial / intro offer, or null
    price: 0, priceString: "$0.00",
    period: "P1W", periodUnit: "week", periodCount: 1,
    cycles: 1, type: "trial"
  },
  offering: "default",
  package: "$rc_monthly",
  packageType: "monthly"
} */
```

This is how you build a **custom paywall in Base44** with real store prices. Map over `products`, render `priceString`, and call `buy(id)` on tap. Never hardcode a price: the store localizes it per country.

**About product ids:** the two stores write subscription ids differently — iOS as one App Store product id, Android as `subscriptionId:basePlanId`. So the same "premium monthly" can appear as `premium_monthly` on an iOS device and `premium:monthly` on Android. Never compare against a hardcoded product id in app logic; gate on entitlement ids (`has('premium')`), which are identical on both platforms.

### `revenuecat.offers(offering?)`: the full catalog envelope

`revenuecat.offers()` returns the raw structure behind `plans()`/`products()` — `{ ok, current, offerings: [{ id, current, packages }], products, error, code }` — when you need offering and package placement rather than a flat list.

### `revenuecat.buy(id)`: direct purchase

```javascript
const result = await revenuecat.buy('monthly')   // plan id, product id, or plan object

if (result.ok) {
  // result.entitlements → ["premium"], active entitlements after purchase
  // result.transaction  → the store transaction id
  celebrate()
} else if (result.cancelled) {
  // user closed the sheet, no error to show
} else {
  show(result.error)
}
```

Resolves when the store sheet settles: success, user-cancel, or failure. Never rejects.

Purchases also work **before** anyone logs in: with no `user(id)` bound, the purchase attaches to RevenueCat's anonymous user for the device (the store still owns the receipt), and calling `user(id)` later merges that history onto the account. That is RevenueCat's recommended flow for apps where the paywall can appear before signup.

### Free trials, introductory offers & discounts

Configure trials and intro pricing where they belong, App Store Connect / Google Play Console + RevenueCat, and they need **zero code**:

```javascript
await revenuecat.buy('monthly')   // the store applies the trial automatically when eligible
```

Apple applies introductory offers to eligible customers by itself; on Android the bridge purchases RevenueCat's default option, which prefers the longest eligible free trial, then the cheapest intro phase, then base price. Eligibility is enforced by the store at purchase time, so you can't accidentally grant a second trial.

Show it before purchase from `plans()`:

```javascript
const [monthly] = await revenuecat.plans()

if (monthly.trial) {
  label.textContent = `${monthly.trial.days} days free, then ${monthly.price.text}/month`
} else if (monthly.intro) {
  label.textContent = `${monthly.intro.price.text} for your first ${monthly.intro.period.value} ${monthly.intro.period.unit}s`
}
```

All three Apple intro types are normalized (`trial`, and `intro` with `type: 'payg' | 'upfront'`), and Google base-plan offer phases map onto the same shape, so your UI code never branches per platform.

**Targeted discounts** (win-back offers, retention pricing): **target with an offering, not a buy option.**

```javascript
// Build a "winback" offering in RevenueCat, then present it to the right people
const info = await revenuecat.info()
if (info.entitlements.premium?.unsubscribed) {
  await revenuecat.paywall('winback')        // or: await revenuecat.plans('winback')
}
```

`info().entitlements.<id>.unsubscribed` marks exactly the window worth targeting: cancelled, but still inside the paid period. Offering-based targeting works on both platforms today.

> **`buy(id, { offer })` is not implemented natively yet.** The package forwards the offer id, but no current build reads it: the native purchase action accepts only the product and the user id, so the store applies its default offer logic and your targeted price is silently *not* used. The option is accepted for forward compatibility, not because it works — don't build a discount flow on it. Use an offering, as above.

> **A misspelled offering id shows your default offering.** `paywall('winbak')` does not fail: on both iOS and Android the native layer falls back to presenting your **default** offering, so a full-price paywall appears where you meant a discount. Copy offering ids exactly. (`plans(id)` and `offers(id)` behave differently on purpose: an unknown id there answers `offeringNotFoundError` with no products rather than widening to the full catalog.)

Tag manual-only Google offers `rc-ignore-offer` in RevenueCat so automatic selection never turns your win-back price into the acquisition price. This matters *more* while explicit-offer purchase is unimplemented: the tag is the only thing keeping a retention price out of the default selection. And if you use `revenuecat.paywall()`, RevenueCat Paywalls render configured trials, intro offers, and promotional offers for you, with no offer code at all.

### `revenuecat.redeem()`: Apple offer codes

Apple's redeemable subscription codes for marketing campaigns:

```javascript
const r = await revenuecat.redeem()   // opens Apple's redemption sheet on iOS
// r.supported === false on Android (Play codes are redeemed in the Play Store app)
// and on builds that predate the redeem bridge — always render your redeem
// button conditionally on r.supported
```

### `revenuecat.paywall(offering?)`: RevenueCat native paywall

```javascript
const result = await revenuecat.paywall()            // the offering's paywall from your RC dashboard
// result.ok         → purchased (or restored: result.restored === true)
// result.cancelled  → closed without buying
if (result.ok) unlockPremium()
```

One resolved promise per presentation. The paywall renders natively, shows each user their own currency, and is A/B-testable and restylable from the RevenueCat dashboard **without an app update**. That is the strongest option for conversion.

### `revenuecat.has(entitlement)`: the client gate

```javascript
if (await revenuecat.has('premium')) unlockPremium()
```

The one-liner for showing and hiding premium UI. Checks RevenueCat's entitlement state plus the device's own store history, so it also works offline and before login. Use it on app load and after every purchase, and keep anything truly valuable behind the server check below.

### `revenuecat.status()` / `revenuecat.restore()`: full entitlement snapshot

```javascript
const s = await revenuecat.status()
// s.active        → ["premium"]            active entitlement ids
// s.all           → ["premium", "plus"]    every entitlement ever seen for this user
// s.subscriptions → ["premium:monthly"]    active subscription products (store-native id form)
// s.purchases     → full store history rows (transaction ids, expiry, renewal state)
// s.management    → deep link to the native manage-subscription screen (or null)
// s.details       → raw per-entitlement lifecycle state (current builds; info() is the friendly view)
```

`revenuecat.restore()` re-reads the device's purchase history. Wire it to a "Restore purchases" button (App Store review expects one; the RevenueCat paywall and Customer Center also include their own).

### `revenuecat.info()`: per-entitlement lifecycle for account screens

The same snapshot as `status()`, plus a normalized per-entitlement detail map — the right read for "Manage subscription" screens and win-back logic:

```javascript
const info = await revenuecat.info()
const p = info.entitlements.premium
// p.active        → access right now
// p.period        → 'trial' | 'intro' | 'promo' | 'normal' | 'prepaid' | null (older builds)
// p.bought        → purchase date, p.expires → current period end
// p.renews        → false the moment the user turns auto-renew off, even while access continues
// p.unsubscribed  → when the user cancelled while still inside the paid period
//                   (the window where a win-back offer is worth showing)
// p.billingIssue  → set while the store retries a failed payment (grace period)
// p.store         → 'app_store' | 'play_store' | 'stripe' | 'promotional' | ...
// p.ownership     → 'purchased' | 'family_shared'
// p.sandbox       → true for sandbox/TestFlight purchases
// info.manage     → deep link to the native manage-subscription screen
```

On current builds these come straight from RevenueCat's own lifecycle state (they know about renewals, cancellations inside the paid period, and billing retries). Older builds fall back to inference from store history, where the extra fields are absent, so feature-detect: `if (p.unsubscribed) showWinBack()`.

### `revenuecat.center()`: Customer Center

```javascript
const r = await revenuecat.center()   // native manage / restore / cancel / refund UI
// r.ok → the user closed it; r.code === 'unsupported' → this build has no Customer Center
```

### `revenuecat.ready()`: environment snapshot on app start

```javascript
const env = await revenuecat.ready()
// { native, os, runtime, user, project }, handy for gating your paywall route
```

### Events

```javascript
const stop = revenuecat.on('result', (r) => refresh())    // every purchase/paywall outcome
revenuecat.on('purchase', () => refresh())                // store confirmed a transaction / renewals
revenuecat.on('center', (e) => console.log(e.event))      // Customer Center activity
revenuecat.on('user', (u) => refresh())                   // identity reported (login/logout/whoami settled)
stop()                                                    // unsubscribe one listener
revenuecat.off('purchase')                                // or remove every listener for an event
```

`on()` returns an unsubscribe function; call it (or `off(event, fn)`) when a component unmounts so listeners don't accumulate across remounts.

### Environment

```javascript
revenuecat.native    // true inside your installed Despia app
revenuecat.os        // 'ios' | 'android' | 'web'
revenuecat.runtime   // 4 = Despia Framework, 3 = classic Despia, 0 = browser
revenuecat.id        // current RevenueCat customer id (null when anonymous)
revenuecat.project   // your RevenueCat project id (auto-filled from the Despia build)
revenuecat.debug = true   // log verbose bridge diagnostics to the console
```

Web fallback in one line: send browser users to a [RevenueCat Web Purchase Link](https://www.revenuecat.com/docs/web/web-billing/web-purchase-links):

```javascript
if (!revenuecat.native) location.href = `https://pay.rev.cat/<your_token>/${encodeURIComponent(user.id)}`
```

---

## Gate premium features (the complete client pattern)

```javascript
import revenuecat from 'base44-revenuecat'

async function refreshAccess () {
  applyPremium(await revenuecat.has('premium'))
}

await revenuecat.user(user.id)      // as soon as Base44 auth resolves
refreshAccess()              // on load
revenuecat.on('result', refreshAccess)    // after purchases, restores, cancellations
revenuecat.on('purchase', refreshAccess)  // renewals & server-side changes
```

The UI follows the store, never a tier flag you set yourself.

## Verify on the server (Base44 backend function, no webhooks, no secrets)

Client checks decide what to *show*. Anything a tampered client could steal (paid exports, credits, premium endpoints) gets verified **when the request arrives**, by asking RevenueCat directly. No webhook handlers, no subscription table to keep in sync, and for the standard check, **no secret key either**: RevenueCat's v1 subscriber endpoint accepts your *public* SDK key, so the only configuration is a value that is public by definition.

```javascript
// functions/premium.js, runs server-side in Base44
import { createClientFromRequest } from 'npm:@base44/sdk'
import { entitled } from 'npm:base44-revenuecat/server'

// Your PUBLIC SDK key from Despia → Integrations → RevenueCat (safe to paste:
// it ships inside your app binary anyway). Configure it HERE, server-side;
// never read it from the request.
const RC_KEY = 'appl_XXXXXXXXXXXX'

export default async function (req) {
  const base44 = createClientFromRequest(req)
  const user = await base44.auth.me()              // server-verified identity, never trust a client-sent id

  let ok = false
  try {
    ok = await entitled(user.id, 'premium', { key: RC_KEY })
  } catch (e) {
    // RevenueCat unreachable / rate limited: fail CLOSED — deny the paid
    // action rather than giving it away. See "Error handling" below.
    return Response.json({ error: 'verification unavailable, retry shortly' }, { status: 503 })
  }
  if (!ok) return Response.json({ error: 'premium required' }, { status: 402 })

  return Response.json({ premium: true /* , ...do the paid work here */ })
}
```

Call it from your app:

```javascript
const { data } = await base44.functions.invoke('premium', {})
```

Because the frontend used `revenuecat.user(user.id)` and the function uses `base44.auth.me().id`, both sides always name the **same RevenueCat customer**. That is the number-one integration mistake, eliminated.

**One side effect to know about:** RevenueCat's v1 subscriber endpoint is *create-on-read* — checking an id RevenueCat has never seen creates that customer (the API answers 200 or 201). The check itself stays correct (a just-created customer has no entitlements, so gates deny), but every distinct user id you verify will appear in your RevenueCat customer list, including users who never opened the mobile app. That's cosmetic for most apps; if you'd rather avoid it, only call `entitled()` for users who have actually been through the app's paywall, or use the secret-key path below.

**Optional upgrade (secret key):** pass `{ secret: secrets.get('RC_SECRET'), project: secrets.get('RC_PROJECT') }` (a `sk_…` key from RevenueCat → API keys, stored in Base44 secrets) to ride RevenueCat's v2 API with project scoping and documented rate limits (480 customer-info requests/min per key; v1 publishes no figure). The v2 customer read does not create customers. Entitlements are matched by their human lookup key (`premium`) on both paths, and if v2 rejects the key or project (401/403/404) the check falls back to v1 automatically and remembers the verdict.

**Configuration details** (all three functions accept the same options):

- Resolution order: explicit `{ key | secret | project }` → env `RC_KEY` / `RC_SECRET` / `RC_PROJECT` → env `REVENUECAT_PUBLIC_KEY` / `REVENUECAT_SECRET_KEY` / `REVENUECAT_PROJECT_ID`.
- `secret` wins over `key` when both are set. Which API path runs is decided by the key's own prefix — only `sk_…` keys ever use v2; an `sk_…` key placed in `RC_KEY` still unlocks v2, and a public key in `RC_SECRET` still works on v1.
- `{ timeout: ms }` bounds each RevenueCat request (default 10 s); a hung connection aborts and throws instead of hanging your function.
- `{ sandbox: true }` (or env `RC_SANDBOX=true`) includes sandbox purchases — required while testing, see [Testing](#testing). Off in production.
- The `/server` entry also exports `entitlements(user)` (active entitlements with expiry) and `customer(user)` (the raw RevenueCat subscriber) and works in any Node (18+) or Deno backend.

## Error handling

**Client (`base44-revenuecat`): resolves, never rejects.** Every call answers with an envelope carrying `ok`, a human-readable `error`, and a machine-readable `code`:

| `code` | Meaning |
|---|---|
| `web` | Not running inside a Despia app (browser / Base44 preview) |
| `no_module` | The RevenueCat module is excluded from this build |
| `unsupported` | This build doesn't carry the requested feature (e.g. Customer Center, redeem) |
| `timeout` | The native layer didn't answer in time |
| `call_failed` | The native call itself threw |
| `empty` | The native layer answered with nothing |
| `missing_param` | A required argument was missing or invalid |
| `user_cancelled` | The user closed the store sheet without buying |
| `offeringNotFoundError` | No offering matched the requested id |

Native layers may surface additional store-specific codes verbatim. Branch on `result.cancelled` first (not an error to show anyone), then show `result.error` for the rest.

**Server (`base44-revenuecat/server`): throws, on purpose.** `entitled()`, `entitlements()`, and `customer()` throw when no API key is configured, when RevenueCat answers non-2xx (including `429` rate limits — the thrown error has a `.status`), and on network failures or timeouts. Always wrap them in `try/catch` and **fail closed**: deny the paid action on error, as in the example above. Silent `false` would be indistinguishable from "not subscribed"; a thrown error tells you verification itself failed.

### What about cancellations?

You learn about a lapse at the user's next check, which is their next request anyway, because both gates re-ask RevenueCat every time. That is exactly what webhooks would have told you, minus the retries, signatures, and event tables. If you later want real-time pushes (lapse emails, live session cuts), add a [RevenueCat webhook](https://www.revenuecat.com/docs/integrations/webhooks) as an extra layer, it's never the thing to debug before your first paying customer.

---

## Works on every Despia runtime

The package detects the runtime at call time and speaks its native dialect. Same API, same JSON, either way:

| Runtime | Detection | Transport |
|---|---|---|
| Despia Framework (V4) | `window.dsx` module bus | `dsx.module.revenuecat.*` promises |
| Despia classic (V3) | `despia` user agent | `revenuecat://` schemes + window callbacks |
| Browser / Base44 preview | neither | safe no-op resolutions |

Detection is automatic and does not depend on you: the Despia Framework is identified by its module bus, the classic runtime by its user agent, and anything else resolves safe empties so your Base44 preview keeps working.

Every native capability is probed at call time and falls back to the next best read the build actually has, so an older binary degrades instead of failing. `plans()` tries the unified catalog, then the offerings read, then the flat product list; `has()` tries the customer envelope, then the entitlements read, then the device's purchase history; `paywall()` accepts either action spelling. Newer capabilities (native session login and logout, the `user()` identity read, RevenueCat-anonymous purchases, explicit offers, offer-code redemption) are probed the same way, and on builds that predate the anonymous fallback the package quietly supplies a stable per-device id for purchases. You never version-match JavaScript against binaries, and rebuilding in Despia simply upgrades the path each call takes.

## Prompt for AI builders

Building with Base44's AI (or any coding agent)? Paste this into your prompt:

```text
Using the base44-revenuecat npm package:

1. Identify the signed-in Base44 user with: await revenuecat.user(user.id)
2. Load live subscription plans with: await revenuecat.plans()
3. Build the paywall screen from the returned plans. Always display plan.price.text
   (the store-localized price). Show plan.trial.days when a free trial exists.
4. Purchase with: await revenuecat.buy(plan.id). Check result.ok and result.cancelled;
   the call resolves (never throws).
5. Gate premium UI on: await revenuecat.has('premium'), replacing 'premium' with an
   entitlement id that actually exists in this project's RevenueCat dashboard
   (Product catalog, Entitlements). Ask which id to use rather than inventing one:
   an entitlement that was never created is false for every user, always.
6. Add a "Restore purchases" button calling: await revenuecat.restore()
7. On app logout call: await revenuecat.logout()
8. Do not hardcode prices or currencies.
9. Do not create a subscriptions table and do not add RevenueCat webhooks.
10. Do not install any other RevenueCat SDK (no Capacitor/cordova plugins). The
    native SDK ships inside the Despia build.
```

## Testing

- **iOS**: test on TestFlight with a **Sandbox Apple ID** (Settings → App Store → Sandbox Account). Sandbox renewals are accelerated (a month ≈ 5 minutes).
- **Android**: add your Google account as a **license tester** in Play Console, install from an Internal Testing track.
- Purchases in sandbox are free and RevenueCat's dashboard shows them within seconds. Watch the Customer view while you test (its **Sandbox data** toggle controls what you see).
- **The server check does NOT see sandbox purchases by default.** RevenueCat's API answers with production purchases only, so a sandbox subscription makes the client say entitled and `entitled()` say not. Pass `{ sandbox: true }` (or set `RC_SANDBOX=true`) while testing, and turn it off for production:

```javascript
const testing = Deno.env.get('RC_SANDBOX') === 'true'
const ok = await entitled(user.id, 'premium', { key: RC_KEY, sandbox: testing })
```

## Troubleshooting

- **`products()` returns `[]` in the installed app** → the build predates the RevenueCat integration or the keys were added after the last build: check Despia → Integrations → RevenueCat, then rebuild. Also confirm your products are attached to an offering in RevenueCat.
- **`has('premium')` is false right after buying** → in order of likelihood: (a) you copied `premium` out of these docs and no entitlement with that id exists in your RevenueCat dashboard, so it can never be true. Use your own id. (b) The entitlement exists but the purchased product is not attached to it (Product catalog → Entitlements). (c) The id differs by case or whitespace: it is matched literally, so `Premium` is not `premium`. (d) You bought a consumable or credit pack, which grants no entitlement by design. Check `result.ok` for those, not `has()`. `status()` shows the ids the device actually sees, which is the fastest way to tell these apart.
- **Server check says false, client says true** → two causes, in order of likelihood. (a) **You are testing in sandbox.** RevenueCat's API returns production purchases only unless you pass `{ sandbox: true }` (or set `RC_SANDBOX=true`), so a TestFlight or license-tester purchase is invisible to `entitled()` while the device can see it. (b) The ids differ: log `revenuecat.id` in the app and `user.id` in the function, they must be identical strings.
- **Nothing happens in the browser** → correct: purchases only exist inside the installed iOS/Android app. Preview logic with `revenuecat.native`.
- **A `buy()` call seems stuck right after a paywall was shown** → purchase, paywall, and redeem outcomes share one native result channel and are processed in order. If a paywall was presented but the native layer never reported its outcome (e.g. the app was killed mid-sheet), queued purchase calls wait behind it until the paywall wait times out. A fresh app start clears the queue.
- **`has()` feels slow / you call it on every render** → each `has()`/`status()` call re-asks the native layer (a customer read, plus store history on classic builds). Check once per screen or on the `result`/`purchase` events, keep the boolean in your app state, and re-check after purchases — as in the [complete client pattern](#gate-premium-features-the-complete-client-pattern).
- **A logged-out user on a shared device still shows premium** → the native RevenueCat SDK remembers the last identified user across app restarts, and `user()` (no arguments) adopts it. Gate premium UI on your own auth state too: `const premium = user && await revenuecat.has('premium')`, and call `revenuecat.logout()` when your app logs out.

## FAQ

### Can a Base44 app have in-app purchases?

Yes. Publish your Base44 app as a native iOS and Android app with [Despia](https://despia.com), enable the RevenueCat integration, and this package gives you App Store and Google Play subscriptions with a promise-based JavaScript API, with no Swift, no Kotlin, no webhooks.

### How do I put my Base44 app on the App Store and Google Play?

Despia wraps your Base44 app in a real native binary and walks you through store submission. See [despia.com](https://despia.com) and the [setup guides](https://setup.despia.com).

### Can I use Stripe for subscriptions inside a Base44 mobile app?

Not for digital content and features used inside the app. Apple and Google require their own billing there, and a Stripe checkout in a web view is one of the most common causes of rejection. This package uses StoreKit and Play Billing, which is the compliant path. Stripe remains the right tool for physical goods, real-world services, and your web checkout.

### Do I need my own backend for subscriptions?

No. Client gating works with zero backend. For protected server actions, a single Base44 backend function with `entitled()` is enough. RevenueCat is the source of truth, you never mirror it into your own tables.

### What is the difference between a product and an entitlement?

A product is what the store sells (`premium_monthly`, `premium_annual`). An entitlement is what it unlocks (`premium`). Attach both your iOS and Android products to one entitlement, then gate your app on `has('premium')` and your code never branches per platform or per plan.

You name the entitlement yourself when you create it in RevenueCat, and both names above are just examples. There is no standard or built-in entitlement id, so `premium` carries no special meaning to RevenueCat, to Despia, or to this package. Whatever you type in the dashboard is the exact string your code must pass.

[The entitlements guide](ENTITLEMENTS.md) covers this end to end: creating one, attaching subscriptions and lifetime unlocks, why consumable credits are not entitlements, stacked tiers, and reading the lifecycle correctly.

### How do I test purchases before launch?

On iOS use a Sandbox Apple ID through TestFlight, where a month renews in about five minutes. On Android add yourself as a license tester in Play Console and install from an Internal Testing track. Sandbox purchases are free and appear in the RevenueCat dashboard within seconds.

### Why does `products()` come back empty?

Almost always one of three things: the app was built before the RevenueCat keys were added in Despia (rebuild), the products are not attached to an offering in RevenueCat, or the store products are not yet approved. See [Troubleshooting](#troubleshooting).

### Does this work with other AI app builders?

The package targets Base44 conventions, but the native layer underneath is Despia, which turns any web app into an iOS and Android binary. If you build with a different tool, the same RevenueCat integration is available through [despia-native](https://www.npmjs.com/package/despia-native).

### What does RevenueCat cost?

Free until well past your first revenue (see [revenuecat.com/pricing](https://www.revenuecat.com/pricing)); no card needed to start.

---

## Links

- [Despia: publish Base44 apps as native iOS & Android apps](https://despia.com)
- [Despia setup guides & RevenueCat docs](https://setup.despia.com)
- [RevenueCat dashboard](https://app.revenuecat.com)
- [The entitlements guide](ENTITLEMENTS.md) · [Changelog](CHANGELOG.md)
- Support: [support@despia.com](mailto:support@despia.com)

## License

[Apache-2.0](LICENSE) © Despia
