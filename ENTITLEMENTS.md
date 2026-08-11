# Entitlements: the complete guide

Everything about the one concept that decides whether your app unlocks or stays locked: what an
entitlement is, how to create one, how to attach subscriptions and one-time purchases to it, how
consumable credits differ, and how to read it correctly in your Base44 app and on your server.

If you read one line: **an entitlement is a name you invent for something your app unlocks, and
you create it yourself in the RevenueCat dashboard.** Nothing is built in. `premium` is this
project's example, not a reserved word.

- [What an entitlement is](#what-an-entitlement-is)
- [Why not just check the product id](#why-not-just-check-the-product-id)
- [Create your first entitlement](#create-your-first-entitlement)
- [Attach products: subscriptions and one-time purchases](#attach-products-subscriptions-and-one-time-purchases)
- [Consumables: the one thing that is not an entitlement](#consumables-the-one-thing-that-is-not-an-entitlement)
- [Use it in your app](#use-it-in-your-app)
- [Read the lifecycle, not just the on/off](#read-the-lifecycle-not-just-the-onoff)
- [Check it on your server](#check-it-on-your-server)
- [Tiers and multiple entitlements](#tiers-and-multiple-entitlements)
- [Test it before launch](#test-it-before-launch)
- [Common mistakes](#common-mistakes)

---

## What an entitlement is

Three different things get confused constantly, so name them once and the rest of this guide is easy:

| Term | What it is | Who names it | Example |
|---|---|---|---|
| **Product** | The thing the store sells and charges for. Created in App Store Connect and Google Play. | You, in each store | `premium_monthly`, `premium_annual` |
| **Offering** | A group of products you show on one paywall. Created in RevenueCat. | You, in RevenueCat | `default` |
| **Entitlement** | The thing your app unlocks. A permission, not a purchase. Created in RevenueCat. | **You, in RevenueCat** | `premium` |

An entitlement is a label that means "this customer is allowed to use the paid stuff." RevenueCat
decides which customers currently carry that label by looking at every purchase they have made on
every platform, then hands your app the answer.

Your app never reasons about receipts, renewal dates, refunds, upgrades, or which store the person
bought from. It asks one question:

```javascript
if (await revenuecat.has('premium')) unlockPremium()
```

## Why not just check the product id

Because the product id is the thing that keeps changing, and the permission is the thing that does not.

Gate on `premium` and all of this becomes free:

- **Two stores, one check.** `premium_monthly` on iOS and `premium_monthly` on Android are different
  products in different systems. Both grant `premium`. Your code never branches per platform.
- **Many plans, one check.** Monthly, annual, a lifetime unlock, and a promo you granted by hand in
  the RevenueCat dashboard all grant `premium`. Your gate does not grow a new `if` per plan.
- **Pricing changes are not code changes.** Launch `premium_quarterly` next month, attach it to
  `premium`, and every shipped app already honors it. No rebuild, no app review.
- **Grandfathering works.** Retire `premium_monthly_v1`, keep it attached, and existing subscribers
  keep access forever while new customers buy the new product.

Gate on product ids instead and every one of those turns into an app update. This is the entire
reason the indirection exists.

## Create your first entitlement

In the RevenueCat dashboard:

1. Open **Product catalog → Entitlements → + New**.
2. Enter an **identifier**. This is the exact string your code will pass to `has()`. Lowercase, no
   spaces, and stable forever: `premium`, `pro`, `no_ads`, `team`.
3. Give it a description for your own benefit. Only the identifier matters to code.
4. Save, then attach products to it (next section). **An entitlement with no products attached can
   never turn true**, no matter how many purchases succeed.

Two rules that save real pain later:

- **The identifier is matched literally.** `Premium` is not `premium`. A trailing space is a
  different id. Copy and paste it into your code, do not retype it.
- **Never rename an entitlement after launch.** Shipped apps ask for the old id and will get
  `false` for every customer. Create a new one and gate on both during the transition instead.

**How many should you create?** One per thing you unlock independently. Most apps need exactly one.
If everything paid unlocks together, one entitlement is the correct design and more will only cost
you complexity. See [Tiers](#tiers-and-multiple-entitlements) if you genuinely sell separable things.

## Attach products: subscriptions and one-time purchases

Attaching is what connects "they paid" to "they are allowed." In **Product catalog → Entitlements →
your entitlement → Attach products**, add every product that should grant it, from both stores.

The mechanics differ by product type, and the difference is visible in what your app reads back:

### Auto-renewing subscriptions

The normal case: `premium_monthly`, `premium_annual`, and their Android equivalents.

- Access begins at purchase and **expires** at the end of each paid period unless it renews.
- `expires` carries a real date. `renews` tells you whether it is set to continue.
- RevenueCat keeps it in sync across renewals, cancellations, refunds, upgrades, downgrades, grace
  periods and billing retries. You do nothing.

Attach **every** plan that should unlock the same thing to the same entitlement. Monthly and annual
are two products and one entitlement, never two entitlements.

### One-time purchases that unlock forever (non-consumables)

A lifetime unlock, a paid app tier, "remove ads" bought once.

- Attach it exactly like a subscription. This is the supported, intended use.
- Access never expires: `expires` is `null` and stays that way.
- **`renews` is `false`, and that is correct.** Nothing is renewing because nothing needs to. See
  [the lifecycle section](#read-the-lifecycle-not-just-the-onoff), because this trips people up.

### Promotional grants

You can hand someone access from the RevenueCat dashboard (Customer → Grant entitlement) for
support cases, press, or refund recovery. It grants the entitlement with no store purchase behind
it, arrives as `store: 'promotional'`, and works through the same `has()` call. Nothing to build.

### Quick reference

| Product type | Attach to an entitlement? | `expires` | `renews` | Your app reads |
|---|---|---|---|---|
| Auto-renewing subscription | Yes | a date | `true` while set to continue | `has()` |
| Non-consumable / lifetime unlock | Yes | `null` | always `false` | `has()` |
| Promotional grant | Granted directly | date or `null` | `false` | `has()` |
| **Consumable (credits, coins, gems)** | **No** | n/a | n/a | `result.ok`, your own balance |

## Consumables: the one thing that is not an entitlement

A consumable is bought repeatedly and spent: 100 coins, 10 export credits, a single-use boost.
**Do not attach consumables to an entitlement.**

Here is the concrete reason, from the SDK's own logic. RevenueCat treats an entitlement with no
expiration date as a lifetime grant. A consumable has no expiration date. So attaching one grants
permanent access on the first purchase, which means:

- The customer buys 100 coins once and is permanently "entitled" forever.
- Buying a second pack changes nothing observable, because the flag is already on.
- Nothing ever decrements, because an entitlement is a yes/no permission and not a balance.

Model consumables the way they actually behave instead:

```javascript
const result = await revenuecat.buy('coins_100')

// A completed transaction is the success. Consumables grant no entitlement by design,
// so an empty entitlements array here is correct and not a failure.
if (result.ok && !result.cancelled) {
  await addCreditsToUser(user.id, 100)   // your Base44 backend owns the balance
}
```

Keep the balance in your own Base44 data, credited from a verified purchase result and debited as
the user spends. RevenueCat is the source of truth for *permissions*; your app is the source of
truth for *quantities*.

An app can absolutely do both: a `premium` subscription entitlement plus a separate coin balance.
They do not interact.

## Use it in your app

### The gate

```javascript
if (await revenuecat.has('premium')) unlockPremium()
```

Call it on app load and again after every purchase, restore, and login. It checks RevenueCat's
entitlement state plus the device's own store history, so it still answers correctly offline and
before the user has logged in.

### Identify the user first

Entitlements belong to a RevenueCat customer, so bind your Base44 user before you read or buy:

```javascript
await revenuecat.user(user.id)          // same id you use everywhere else
```

Skip this and purchases attach to an anonymous device customer, which is the usual cause of
"they paid on their phone but the website says no."

### The complete client pattern

```javascript
async function refreshEntitlements() {
  await revenuecat.user(user.id)
  applyPremium(await revenuecat.has('premium'))
}

await refreshEntitlements()                     // on app load

const result = await revenuecat.buy(plan.id)    // after a purchase
if (result.ok) await refreshEntitlements()

await revenuecat.restore()                      // "Restore purchases" button
await refreshEntitlements()
```

### Everything at once

```javascript
const s = await revenuecat.status()
// s.active        → ["premium"]           entitlement ids that are on right now
// s.all           → ["premium", "pro"]    every entitlement this customer ever had
// s.subscriptions → ["premium_monthly"]   active subscription product ids
```

`s.active` is the list to gate on. If it is `[]` right after a successful purchase, jump to
[Common mistakes](#common-mistakes).

## Read the lifecycle, not just the on/off

`has()` answers yes or no. `info()` tells you *which kind* of yes, which is what account screens
and win-back offers are built from:

```javascript
const info = await revenuecat.info()
const e = info.entitlements.premium

e.active        // true while access continues
e.renews        // false once auto-renew is off, and for lifetime unlocks
e.expires       // when access ends, null for a lifetime unlock
e.period        // 'normal' | 'trial' | 'intro' | 'promo' | 'prepaid' (null on builds that don't report it)
e.unsubscribed  // when they cancelled, while still inside the paid period
e.billingIssue  // set while the store retries a failed payment
e.store         // 'app_store' | 'play_store' | 'stripe' | 'promotional' | ...
e.ownership     // 'purchased' | 'family_shared'
```

**`renews: false` does not mean they are losing access.** This is the single most misread field, so
be precise about it. The RevenueCat SDK computes it as:

> not renewing if the grant is **promotional**, or **lifetime** (no expiry), or the user
> **unsubscribed**, or there is a **billing issue**, or the plan is **prepaid**.

Five different situations, one `false`. Treat them differently:

| What you see | What is happening | What to do |
|---|---|---|
| `active: true`, `renews: false`, `expires: null` | Lifetime unlock. Permanent. | Nothing. Never show a renewal warning. |
| `active: true`, `renews: false`, `unsubscribed` set | Cancelled but still paid up. | The win-back window. Offer something before `expires`. |
| `active: true`, `renews: false`, `billingIssue` set | Payment is being retried. | Prompt a card update. Do not treat as churned. |
| `active: true`, `renews: true` | Healthy subscriber. | Nothing. |
| `active: false` | Access is over. | Show the paywall. |

Gate features on `active`. Use the rest for messaging, never for access.

Older Despia builds that predate this lifecycle data still answer `active`, `product`, `period`,
`bought`, `expires` and `renews` from store history, so this code is safe to ship everywhere. The
newer fields are simply absent rather than wrong.

## Check it on your server

Client checks decide what to *show*. Anything a tampered client could steal gets verified when the
request arrives:

```javascript
// functions/premium.js, runs server-side in Base44
import { entitled } from 'npm:base44-revenuecat/server'

// Your PUBLIC SDK key (appl_… / goog_…) from Despia → Integrations →
// RevenueCat. Configure it here, server-side — never read it from the request.
// Either platform's key works and one is enough: the check reads your project,
// not a store, so an appl_ key also verifies Google Play subscribers.
const RC_KEY = 'appl_XXXXXXXXXXXX'   // or 'goog_XXXXXXXXXXXX'

let ok = false
try {
  ok = await entitled(user.id, 'premium', { key: RC_KEY })
} catch (e) {
  // RevenueCat unreachable / rate limited: fail closed, deny the paid action.
  return Response.json({ error: 'verification unavailable, retry shortly' }, { status: 503 })
}
if (!ok) return Response.json({ error: 'premium required' }, { status: 402 })
```

While testing with a Sandbox Apple ID or a Play license tester, add `sandbox: true` to those
options: RevenueCat answers with production purchases only by default, so a sandbox purchase the
device can see is invisible to the server check.

Same entitlement id, same string, asked of RevenueCat directly. No webhooks and no subscriptions
table to keep in sync. The user id must be **identical** to the one you passed to
`revenuecat.user(id)`, or the server will look up a different customer and correctly say no. The
server helpers throw on network/API failures (unlike the client, which never throws) — always wrap
them in try/catch and deny on error. The README's
[server section](README.md#verify-on-the-server-base44-backend-function-no-webhooks-no-secrets)
covers the secret-key upgrade and every configuration option.

## Tiers and multiple entitlements

Create a second entitlement only when something unlocks **independently**. A `pro` tier that
includes everything in `premium` is not independent.

The clean pattern for stacked tiers is one entitlement per tier, with the higher tier's products
attached to both:

| Product | Attached to |
|---|---|
| `pro_monthly` | `pro` **and** `premium` |
| `premium_monthly` | `premium` |

Now `has('premium')` is true for both audiences and `has('pro')` is true only for the higher tier,
so your gates stay one-liners:

```javascript
const pro     = await revenuecat.has('pro')
const premium = await revenuecat.has('premium')   // also true for pro customers
```

The alternative, gating on `pro || premium` everywhere, spreads your tier rules across the codebase
and breaks the next time you add a tier. Attach in the dashboard, not in `if` statements.

## Test it before launch

- **iOS**: TestFlight with a **Sandbox Apple ID** (Settings → App Store → Sandbox Account). Sandbox
  renewals are accelerated, so a month renews in about five minutes and you can watch a real
  renewal, cancellation and expiry in one sitting.
- **Android**: add your Google account as a **license tester** in Play Console and install from an
  Internal Testing track.
- Watch the **Customer** view in RevenueCat while you test. It shows the entitlement turning on,
  which product granted it, and when it expires. If it is on there and off in your app, the problem
  is the id or the user binding, not the purchase.
- Cancel a sandbox subscription and confirm your app keeps access until `expires` and shows your
  win-back message. That path is otherwise never exercised until a real customer hits it.

Sandbox purchases are free and appear in the dashboard within seconds.

## Common mistakes

**`has('premium')` is false after a successful purchase.** In order of likelihood:

1. No entitlement with that id exists in your dashboard, because `premium` was copied from these
   docs. Use your own id.
2. The entitlement exists but the purchased product is not attached to it.
3. The id differs by case or whitespace. It is matched literally.
4. You bought a consumable, which grants no entitlement by design. Check `result.ok` instead.
5. You never called `revenuecat.user(id)`, so the purchase landed on a different customer.

`revenuecat.status()` shows the ids the device actually sees, which separates these in one call.

**Gating on a product id.** `s.subscriptions.includes('premium_monthly')` breaks the moment you add
an annual plan. Gate on the entitlement.

**Renaming an entitlement after launch.** Shipped apps ask for the old id forever. Add a new one
instead and gate on both while old versions are still in the wild.

**Treating `renews: false` as churn.** It is also true for every lifetime customer and everyone in
a billing retry. See [the lifecycle table](#read-the-lifecycle-not-just-the-onoff).

**Attaching consumables to an entitlement.** Grants permanent access on the first coin pack. Track
balances in your own data.

**Mismatched user ids between app and server.** The most common cause of "client says yes, server
says no." Log `revenuecat.id` in the app and `user.id` in the function and compare them as strings.

**Forgetting the rebuild.** The RevenueCat SDK is compiled into your Despia binary. Dashboard
changes to entitlements and attachments are live immediately, but adding the integration keys for
the first time needs a new build before anything works.

---

Back to the [README](README.md) for the full API reference.
