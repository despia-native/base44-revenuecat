# Base44 In-App Purchases & Subscriptions: RevenueCat for Base44 iOS and Android apps

**Sell real App Store and Google Play subscriptions from your Base44 app.** This package connects a Base44 app, published as a native iOS and Android app with [Despia](https://despia.com), to Apple StoreKit and Google Play Billing through the RevenueCat SDK that Despia compiles into your binary. Query products with live store pricing, launch native paywalls, run purchases, check entitlements, and verify subscribers server-side in Base44 backend functions. Promise-based, three-letter-simple, zero native code, zero webhooks.

[![npm version](https://img.shields.io/npm/v/base44-revenuecat.svg)](https://www.npmjs.com/package/base44-revenuecat)
[![npm downloads](https://img.shields.io/npm/dm/base44-revenuecat.svg)](https://www.npmjs.com/package/base44-revenuecat)
[![types included](https://img.shields.io/npm/types/base44-revenuecat.svg)](./index.d.ts)
[![license](https://img.shields.io/npm/l/base44-revenuecat.svg)](./LICENSE)

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

Every call returns a promise and **never throws**. In the Base44 browser preview each method resolves a safe empty result, so you can build and preview your paywall logic on the web and it simply comes alive inside the installed app.

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
4. **Product catalog → Entitlements → + New**: create one entitlement per thing you unlock, e.g. `premium`. Attach your App Store and Play Store products to it (both stores → one entitlement id, so your app code never branches per platform).
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

Call it once when your app knows who the user is (after Base44 auth), before showing a paywall. Use the stable id, not an email, name, or phone number. Before `user()`, purchases run under a stable per-device anonymous id and RevenueCat merges that history on first identify. (`revenuecat.login(id)` is an alias.)

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
  trial:  { days: 7, eligible: null },   // free trial, when configured
  intro:  null,                          // or { type: 'payg'|'upfront', price, period, cycles }
  offers: []                             // normalized store offers (newer builds)
}
```

`price.text` is **always** the value to display. Never construct a currency string yourself, and never hardcode a price.

### `revenuecat.products()`: App Store / Google Play products with live pricing

```javascript
const products = await revenuecat.products()          // every product across your offerings
const monthly  = await revenuecat.products('default') // or just one offering

/* Each product is the SAME JSON on iOS and Android:
{
  id: "premium:monthly",        // pass straight to revenuecat.buy()
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

This is how you build a **custom paywall in Base44** with real store prices. Map over `products`, render `priceString`, and call `buy(id)` on tap. Never hardcode a price: the store localizes it per country. `revenuecat.offers()` returns the full envelope (offerings → packages → products) when you need the structure.

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

**Targeted discounts** (win-back offers, retention pricing): pass the offer id explicitly:

```javascript
await revenuecat.buy('annual', { offer: 'winback50' })
```

The offer id is forwarded to the native layer and honored on builds with explicit-offer support (iOS promotional offers are fetched signed via RevenueCat; Android selects the matching Google offer). Tip: tag manual-only Google offers `rc-ignore-offer` in RevenueCat so automatic selection never turns your win-back price into the acquisition price. And if you use `revenuecat.paywall()`, RevenueCat Paywalls render configured trials, intro offers, and promotional offers for you, with no offer code at all.

**Offer codes** (Apple's redeemable subscription codes for marketing campaigns):

```javascript
const r = await revenuecat.redeem()   // opens Apple's redemption sheet on iOS
// r.supported === false on Android (Play codes are redeemed in the Play Store app)
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
// s.subscriptions → ["premium:monthly"]    active subscription products
// s.purchases     → full store history rows (transaction ids, expiry, renewal state)
// s.management    → deep link to the native manage-subscription screen (or null)
```

`revenuecat.restore()` re-reads the device's purchase history. Wire it to a "Restore purchases" button (App Store review expects one; the RevenueCat paywall and Customer Center also include their own).

`revenuecat.info()` returns the same snapshot with a per-entitlement detail map for account screens:

```javascript
const info = await revenuecat.info()
// info.entitlements.premium → { active, product, period: 'trial'|'normal'|…, bought, expires, renews }
// info.manage               → deep link to the native manage-subscription screen
```

### `revenuecat.center()`: Customer Center

```javascript
await revenuecat.center()   // native manage / restore / cancel / refund UI, resolves on close
```

### Events

```javascript
const off = revenuecat.on('result', (r) => refresh())     // every purchase/paywall outcome
revenuecat.on('purchase', () => refresh())                // store confirmed a transaction / renewals
revenuecat.on('center', (e) => console.log(e.event))      // Customer Center activity
revenuecat.on('user', (u) => refresh())                   // identity changed (login/logout settled)
off()                                              // unsubscribe
```

### Environment

```javascript
revenuecat.native    // true inside your installed Despia app
revenuecat.os        // 'ios' | 'android' | 'web'
revenuecat.runtime   // 4 = Despia Framework, 3 = classic Despia, 0 = browser
revenuecat.id        // current RevenueCat customer id (null when anonymous)
revenuecat.project   // your RevenueCat project id (auto-filled from the Despia build)
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

Client checks decide what to *show*. Anything a tampered client could steal (paid exports, credits, premium endpoints) gets verified **when the request arrives**, by asking RevenueCat directly. No webhook handlers, no subscription table to keep in sync, and for the standard check, **no secret key either**: RevenueCat's subscriber endpoint accepts your *public* SDK key for reads, so the only configuration is a value that is public by definition.

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

  const ok = await entitled(user.id, 'premium', { key: RC_KEY })
  if (!ok) return Response.json({ error: 'premium required' }, { status: 402 })

  return Response.json({ premium: true /* , ...do the paid work here */ })
}
```

Call it from your app:

```javascript
const { data } = await base44.functions.invoke('premium', {})
```

Because the frontend used `revenuecat.user(user.id)` and the function uses `base44.auth.me().id`, both sides always name the **same RevenueCat customer**. That is the number-one integration mistake, eliminated.

**Optional upgrade (secret key):** pass `{ secret: secrets.get('RC_SECRET'), project: secrets.get('RC_PROJECT') }` (a `sk_…` key from RevenueCat → API keys, stored in Base44 secrets) to ride RevenueCat's v2 API with project scoping and higher rate limits. Entitlements are matched by their human lookup key (`premium`) on both paths. The `/server` entry also exports `entitlements(user)` (active entitlements with expiry) and `customer(user)` (the raw RevenueCat subscriber) and works in any Node or Deno backend via `RC_KEY` / `RC_SECRET` / `RC_PROJECT` environment variables.

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

On older Despia builds that predate the products/customer bridge, `products()`/`plans()` resolve `[]` and `has()` falls back to the device's purchase history, rebuild your app in Despia to get the full catalog API. Newer capabilities (native session login/logout, explicit offers, offer-code redemption) are probed the same way, so the package upgrades itself as builds roll out, you never version-match JavaScript against binaries.

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
5. Gate premium UI on: await revenuecat.has('premium')
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
- Purchases in sandbox are free and RevenueCat's dashboard shows them within seconds. Watch the Customer view while you test.
- The server check also sees sandbox purchases; RevenueCat separates environments in its dashboard.

## Troubleshooting

- **`products()` returns `[]` in the installed app** → the build predates the RevenueCat integration or the keys were added after the last build: check Despia → Integrations → RevenueCat, then rebuild. Also confirm your products are attached to an offering in RevenueCat.
- **`has('premium')` is false right after buying** → entitlement not attached to the purchased product in RevenueCat (Product catalog → Entitlements).
- **Server check says false, client says true** → the ids differ. Log `revenuecat.id` in the app and `user.id` in the function. They must be identical strings.
- **Nothing happens in the browser** → correct: purchases only exist inside the installed iOS/Android app. Preview logic with `revenuecat.native`.

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
- Support: [support@despia.com](mailto:support@despia.com)

Apache-2.0 © Despia
