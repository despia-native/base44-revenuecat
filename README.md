# Base44 In-App Purchases & Subscriptions — RevenueCat for Base44 iOS and Android apps

**Sell real App Store and Google Play subscriptions from your Base44 app.** This package connects a Base44 app — published as a native iOS and Android app with [Despia](https://despia.com) — to Apple StoreKit and Google Play Billing through the RevenueCat SDK that Despia compiles into your binary. Query products with live store pricing, launch native paywalls, run purchases, check entitlements, and verify subscribers server-side in Base44 backend functions. Promise-based, three-letter-simple, zero native code, zero webhooks.

```bash
npm install base44-revenuecat
```

```javascript
import iap from 'base44-revenuecat'

await iap.login(user.id)                 // your Base44 user id = your RevenueCat customer id

const products = await iap.products()    // live App Store / Google Play prices, one JSON shape
await iap.buy(products[0].id)            // native purchase sheet

await iap.paywall()                      // or: the RevenueCat paywall you designed in its dashboard

if (await iap.has('premium')) unlockPremium()   // client-side entitlement gate
```

Every call returns a promise and **never throws** — in the Base44 browser preview each method resolves a safe empty result, so you can build and preview your paywall logic on the web and it simply comes alive inside the installed app.

---

## Why this exists

Base44 builds your web app. [Despia](https://despia.com) turns that Base44 app into a **real native iOS and Android app** you ship to the App Store and Google Play — with push notifications, native UI, and (via this package) **real in-app purchases and auto-renewing subscriptions**. Apple and Google require digital goods to go through StoreKit / Play Billing, so a Stripe checkout in a WebView will get your app rejected; this is the compliant path, and RevenueCat keeps both stores in sync for you.

You do **not** need webhooks, a subscriptions table, or native code. The two questions that matter are answered directly:

- *What should the app show this user?* → `iap.has('premium')` on the device.
- *Should the server run this paid action?* → `entitled(user.id, 'premium')` in a Base44 backend function.

---

## Setup (one time, ~15 minutes, no code)

### Part 1 — RevenueCat

1. Create a free account at [app.revenuecat.com](https://app.revenuecat.com) (free until well past your first revenue).
2. **Project settings → Apps → + New → App Store**: enter your iOS bundle id, upload an App Store Connect API key (App Manager role) and an In-App Purchase key.
3. **Project settings → Apps → + New → Play Store**: enter the same package name and upload your Google Play service-account JSON.
4. **Product catalog → Entitlements → + New**: create one entitlement per thing you unlock — e.g. `premium`. Attach your App Store and Play Store products to it (both stores → one entitlement id, so your app code never branches per platform).
5. **Product catalog → Offerings**: group products into an offering (the `default` offering is what paywalls show), e.g. a monthly and an annual package.
6. Optional but recommended: design your paywall in **Paywalls** — `iap.paywall()` presents it natively, priced in each user's own currency, and you can restyle it from the dashboard without an app update.
7. **Project settings → API keys**: copy the **iOS public SDK key** (`appl_…`), the **Android public SDK key** (`goog_…`), and note your **project id** (`proj…`, shown in Project settings / the dashboard URL).

### Part 2 — Despia (the only step that touches your app)

Open **Despia → Your App → Settings → Integrations → RevenueCat** and paste:

| Field | Value |
|---|---|
| iOS key | your `appl_…` public SDK key |
| Android key | your `goog_…` public SDK key |
| Global project ID | your `proj…` project id |

Then **trigger a new build**. The RevenueCat SDK is compiled into the binary, so integration changes always need a rebuild — until then purchases stay dormant.

That's the entire native setup. Everything else is the JavaScript below, written inside your Base44 app.

---

## API

Small names, promises everywhere, identical behavior on iOS and Android.

### `iap.login(id)` — identify the user

```javascript
// Use your Base44 user's id (stable, unique) as the RevenueCat customer id.
// The SAME id is what your backend verifies later — one id everywhere.
await iap.login(user.id)
```

Call it once when your app knows who the user is (after Base44 auth). Before `login`, purchases run under a stable per-device anonymous id, and RevenueCat merges history on login.

### `iap.products()` — App Store / Google Play products with live pricing

```javascript
const products = await iap.products()          // every product across your offerings
const monthly  = await iap.products('default') // or just one offering

/* Each product is the SAME JSON on iOS and Android:
{
  id: "premium:monthly",        // pass straight to iap.buy()
  type: "subscription",         // or "product" for one-time purchases
  title: "Premium Monthly",
  desc: "Unlimited everything",
  price: 9.99,                  // decimal, user's local currency
  priceString: "$9.99",         // localized by the store — render this
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

This is how you build a **custom paywall in Base44** with real store prices — map over `products`, render `priceString`, and call `buy(id)` on tap. Never hardcode a price: the store localizes it per country. `iap.offers()` returns the full envelope (offerings → packages → products) when you need the structure.

### `iap.buy(id)` — direct purchase

```javascript
const result = await iap.buy(monthly[0].id)   // opens the native store sheet

if (result.ok) {
  // result.entitlements → ["premium"]  — active entitlements after purchase
  // result.transaction  → the store transaction id
  celebrate()
} else if (result.cancelled) {
  // user closed the sheet — no error to show
} else {
  show(result.error)
}
```

Resolves when the store sheet settles: success, user-cancel, or failure. Never rejects.

### `iap.paywall(offering?)` — RevenueCat native paywall

```javascript
const result = await iap.paywall()            // the offering's paywall from your RC dashboard
// result.ok         → purchased (or restored: result.restored === true)
// result.cancelled  → closed without buying
if (result.ok) unlockPremium()
```

One resolved promise per presentation. The paywall renders natively, shows each user their own currency, and is A/B-testable and restylable from the RevenueCat dashboard **without an app update** — the strongest option for conversion.

### `iap.has(entitlement)` — the client gate

```javascript
if (await iap.has('premium')) unlockPremium()
```

The one-liner for showing and hiding premium UI. Checks RevenueCat's entitlement state plus the device's own store history, so it also works offline and before login. Use it on app load and after every purchase — and keep anything truly valuable behind the server check below.

### `iap.status()` / `iap.restore()` — full entitlement snapshot

```javascript
const s = await iap.status()
// s.active        → ["premium"]            active entitlement ids
// s.subscriptions → ["premium:monthly"]    active subscription products
// s.purchases     → full store history rows (transaction ids, expiry, renewal state)
// s.management    → deep link to the native manage-subscription screen (or null)
```

`iap.restore()` re-reads the device's purchase history — wire it to a "Restore purchases" button (App Store review expects one; the RevenueCat paywall and Customer Center also include their own).

### `iap.center()` — Customer Center

```javascript
await iap.center()   // native manage / restore / cancel / refund UI, resolves on close
```

### Events

```javascript
const off = iap.on('result', (r) => refresh())     // every purchase/paywall outcome
iap.on('purchase', () => refresh())                // store confirmed a transaction / renewals
iap.on('center', (e) => console.log(e.event))      // Customer Center activity
off()                                              // unsubscribe
```

### Environment

```javascript
iap.native    // true inside your installed Despia app
iap.os        // 'ios' | 'android' | 'web'
iap.runtime   // 4 = Despia Framework, 3 = classic Despia, 0 = browser
iap.user      // current RevenueCat customer id
iap.project   // your RevenueCat project id (auto-filled from the Despia build)
```

Web fallback in one line — send browser users to a [RevenueCat Web Purchase Link](https://www.revenuecat.com/docs/web/web-billing/web-purchase-links):

```javascript
if (!iap.native) location.href = `https://pay.rev.cat/<your_token>/${encodeURIComponent(user.id)}`
```

---

## Gate premium features (the complete client pattern)

```javascript
import iap from 'base44-revenuecat'

async function refreshAccess () {
  applyPremium(await iap.has('premium'))
}

await iap.login(user.id)     // as soon as Base44 auth resolves
refreshAccess()              // on load
iap.on('result', refreshAccess)    // after purchases, restores, cancellations
iap.on('purchase', refreshAccess)  // renewals & server-side changes
```

The UI follows the store — never a tier flag you set yourself.

## Verify on the server (Base44 backend function, no webhooks)

Client checks decide what to *show*. Anything a tampered client could steal — paid exports, credits, premium endpoints — gets verified **when the request arrives**, by asking RevenueCat directly. No webhook handlers, no subscription table to keep in sync.

1. In RevenueCat: **Project settings → API keys → + New secret key** (`sk_…`).
2. In Base44: add a secret named `RC_SECRET` with that key (Settings → Secrets, or `secrets set` from the CLI). Optionally add `RC_PROJECT` with your `proj…` id.
3. Create a backend function:

```javascript
// functions/premium.js — runs server-side in Base44
import { createClientFromRequest } from 'npm:@base44/sdk'
import { secrets } from 'base44:runtime'
import { entitled } from 'npm:base44-revenuecat/server'

export default async function (req) {
  const base44 = createClientFromRequest(req)
  const user = await base44.auth.me()              // server-verified identity — never trust a client-sent id

  const ok = await entitled(user.id, 'premium', {
    secret: secrets.get('RC_SECRET'),
    project: secrets.get('RC_PROJECT')             // optional — enables RevenueCat's v2 API
  })
  if (!ok) return Response.json({ error: 'premium required' }, { status: 402 })

  return Response.json({ premium: true /* , ...do the paid work here */ })
}
```

4. Call it from your app:

```javascript
const { data } = await base44.functions.invoke('premium', {})
```

Because the frontend used `iap.login(user.id)` and the function uses `base44.auth.me().id`, both sides always name the **same RevenueCat customer** — the number-one integration mistake, eliminated.

The `/server` entry also exports `entitlements(user)` (all active entitlements with expiry) and `customer(user)` (the raw RevenueCat subscriber) and works in any Node or Deno backend via `RC_SECRET` / `RC_PROJECT` environment variables.

### What about cancellations?

You learn about a lapse at the user's next check — which is their next request anyway, because both gates re-ask RevenueCat every time. That is exactly what webhooks would have told you, minus the retries, signatures, and event tables. If you later want real-time pushes (lapse emails, live session cuts), add a [RevenueCat webhook](https://www.revenuecat.com/docs/integrations/webhooks) as an extra layer — it's never the thing to debug before your first paying customer.

---

## Works on every Despia runtime

The package detects the runtime at call time and speaks its native dialect — same API, same JSON, either way:

| Runtime | Detection | Transport |
|---|---|---|
| Despia Framework (V4) | `window.dsx` module bus | `dsx.module.revenuecat.*` promises |
| Despia classic (V3) | `despia` user agent | `revenuecat://` schemes + window callbacks |
| Browser / Base44 preview | neither | safe no-op resolutions |

On older Despia builds that predate the products/customer bridge, `products()` resolves `[]` and `has()` falls back to the device's purchase history — rebuild your app in Despia to get the full catalog API.

## Testing

- **iOS**: test on TestFlight with a **Sandbox Apple ID** (Settings → App Store → Sandbox Account). Sandbox renewals are accelerated (a month ≈ 5 minutes).
- **Android**: add your Google account as a **license tester** in Play Console, install from an Internal Testing track.
- Purchases in sandbox are free and RevenueCat's dashboard shows them within seconds — watch the Customer view while you test.
- The server check also sees sandbox purchases; RevenueCat separates environments in its dashboard.

## Troubleshooting

- **`products()` returns `[]` in the installed app** → the build predates the RevenueCat integration or the keys were added after the last build: check Despia → Integrations → RevenueCat, then rebuild. Also confirm your products are attached to an offering in RevenueCat.
- **`has('premium')` is false right after buying** → entitlement not attached to the purchased product in RevenueCat (Product catalog → Entitlements).
- **Server check says false, client says true** → the ids differ. Log `iap.user` in the app and `user.id` in the function — they must be identical strings.
- **Nothing happens in the browser** → correct: purchases only exist inside the installed iOS/Android app. Preview logic with `iap.native`.

## FAQ

**Can a Base44 app have in-app purchases?**
Yes. Publish your Base44 app as a native iOS and Android app with [Despia](https://despia.com), enable the RevenueCat integration, and this package gives you App Store and Google Play subscriptions with a promise-based JavaScript API — no Swift, no Kotlin, no webhooks.

**How do I put my Base44 app on the App Store and Google Play?**
Despia wraps your Base44 app in a real native binary and walks you through store submission — see [despia.com](https://despia.com) and the [setup guides](https://setup.despia.com).

**Do I need my own backend for subscriptions?**
No. Client gating works with zero backend. For protected server actions, a single Base44 backend function with `entitled()` is enough — RevenueCat is the source of truth, you never mirror it.

**Does Apple/Google allow Stripe or card payments for digital goods?**
For digital content and features inside the app, the stores require their own billing (StoreKit / Play Billing) — which is exactly what this package uses, so your app passes review.

**What does RevenueCat cost?**
Free until well past your first revenue (see [revenuecat.com/pricing](https://www.revenuecat.com/pricing)); no card needed to start.

---

## Links

- [Despia — publish Base44 apps as native iOS & Android apps](https://despia.com)
- [Despia setup guides & RevenueCat docs](https://setup.despia.com)
- [RevenueCat dashboard](https://app.revenuecat.com)
- Support: [support@despia.com](mailto:support@despia.com)

Apache-2.0 © Despia
