// Smoke tests for base44-revenuecat: simulates the three runtimes the package
// targets, plain browser, Despia V3 (scheme bridge + window callbacks), and
// Despia V4 (window.dsx module promises), and asserts the unified shapes.
// Run: node test.js

'use strict'

const assert = require('assert')

// A rejection or throw that lands after a scenario resolves must FAIL the run,
// not vanish into the exit. Without this, process.exit(0) can truncate a real
// late failure and report success.
process.on('unhandledRejection', (e) => {
  console.error('\nUNHANDLED REJECTION (a late async failure):', e)
  process.exit(1)
})
process.on('uncaughtException', (e) => {
  console.error('\nUNCAUGHT EXCEPTION (a late async failure):', e)
  process.exit(1)
})

const PRODUCT = {
  id: 'premium:monthly', sku: 'premium', plan: 'monthly', type: 'subscription',
  title: 'Premium Monthly', desc: 'Everything', price: 9.99, priceString: '$9.99',
  currency: 'USD', period: 'P1M', periodUnit: 'month', periodCount: 1,
  intro: null, offering: 'default', package: '$rc_monthly', packageType: 'monthly'
}

const ANNUAL = {
  id: 'premium:annual', sku: 'premium', plan: 'annual', type: 'subscription',
  title: 'Premium Annual', desc: 'Everything, yearly', price: 79.99, priceString: '$79.99',
  currency: 'USD', period: 'P1Y', periodUnit: 'year', periodCount: 1,
  intro: { price: 0, priceString: '$0.00', period: 'P1W', periodUnit: 'week', periodCount: 1, cycles: 1, type: 'trial' },
  offering: 'default', package: '$rc_annual', packageType: 'annual'
}

function envelope (runtime) {
  return {
    ok: true, provider: 'revenuecat', platform: 'ios', runtime, project: 'proj123',
    user: 'u1', anonymous: false, current: 'default',
    offerings: [{
      id: 'default',
      current: true,
      packages: [
        { id: '$rc_monthly', type: 'monthly', product: PRODUCT },
        { id: '$rc_annual', type: 'annual', product: ANNUAL }
      ]
    }],
    products: [PRODUCT, ANNUAL], error: null, code: null
  }
}

function freshRequire () {
  delete require.cache[require.resolve('./index.js')]
  const iap = require('./index.js')
  // Shrink the native-wait timeouts: these tests simulate silent channels
  // with real timers, and nobody wants to wait 8-15 s per silence. The
  // relative ordering (purchase/sheet > reads) is preserved.
  Object.assign(iap._t, { read: 400, catalog: 400, offerings: 400, history: 400, probe: 400, purchase: 900, sheet: 900 })
  return iap
}

async function testWeb () {
  global.window = { navigator: { userAgent: 'Mozilla/5.0' }, localStorage: null }
  global.self = global.window
  const iap = freshRequire()
  assert.strictEqual(iap.native, false)
  assert.strictEqual(iap.os, 'web')
  assert.strictEqual(iap.runtime, 0)
  assert.deepStrictEqual(await iap.products(), [])
  const who = await iap.user()
  assert.deepStrictEqual(who, { id: null, user: null, anonymous: true, registered: false })
  const buy = await iap.buy('x')
  assert.strictEqual(buy.ok, false)
  assert.strictEqual(buy.code, 'web')
  assert.strictEqual(await iap.has('premium'), false)
  const status = await iap.status()
  assert.deepStrictEqual(status.active, [])
  const paywall = await iap.paywall()
  assert.strictEqual(paywall.code, 'web')
  console.log('  web: all calls resolve safe empties ✓')
}

async function testV3 () {
  const fired = []
  const win = {
    navigator: { userAgent: 'Mozilla/5.0 (iPhone) despia-iphone' },
    localStorage: { _s: {}, getItem (k) { return this._s[k] || null }, setItem (k, v) { this._s[k] = v } }
  }
  // The native runtime intercepts assignments to window.despia.
  Object.defineProperty(win, 'despia', {
    set (cmd) {
      fired.push(cmd)
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://login')) {
          win.revenueCatUser = Object.assign({}, envelope(3), {
            new: false, entitlements: { active: ['premium'], all: ['premium'] }
          })
          if (typeof win.onRevenueCatUser === 'function') win.onRevenueCatUser(win.revenueCatUser)
        } else if (cmd.startsWith('revenuecat://logout')) {
          win.revenueCatUser = Object.assign({}, envelope(3), {
            user: null, anonymous: true, new: false, entitlements: { active: [], all: [] }
          })
          if (typeof win.onRevenueCatUser === 'function') win.onRevenueCatUser(win.revenueCatUser)
        } else if (cmd.startsWith('revenuecat://redeem')) {
          win.revenueCatResult = {
            ok: true, cancelled: false, restored: false, source: 'redeem', product: null,
            transaction: null, entitlements: [], user: 'u1', platform: 'ios', runtime: 3,
            error: null, code: 'presented'
          }
          if (typeof win.onRevenueCatResult === 'function') win.onRevenueCatResult(win.revenueCatResult)
        } else if (cmd.startsWith('revenuecat://products')) {
          win.revenueCatProducts = envelope(3)
          if (typeof win.onRevenueCatProducts === 'function') win.onRevenueCatProducts(win.revenueCatProducts)
        } else if (cmd.startsWith('revenuecat://customer')) {
          win.revenueCatCustomer = Object.assign(envelope(3), {
            entitlements: { active: ['premium'], all: ['premium'] },
            subscriptions: ['premium:monthly'], management: null
          })
          if (typeof win.onRevenueCatCustomer === 'function') win.onRevenueCatCustomer(win.revenueCatCustomer)
        } else if (cmd.startsWith('revenuecat://purchase')) {
          assert.ok(cmd.includes('external_id=u1'), 'purchase carries external_id')
          assert.ok(cmd.includes('product=premium%3Amonthly'), 'purchase carries product')
          win.revenueCatResult = {
            ok: true, cancelled: false, restored: false, source: 'purchase',
            product: 'premium:monthly', transaction: 'GPA.1', entitlements: ['premium'],
            user: 'u1', platform: 'ios', runtime: 3, error: null, code: null
          }
          if (typeof win.onRevenueCatResult === 'function') win.onRevenueCatResult(win.revenueCatResult)
        } else if (cmd.startsWith('revenuecat://launchPaywall')) {
          win.revenueCatResult = {
            ok: false, cancelled: true, restored: false, source: 'paywall',
            product: null, transaction: null, entitlements: [], user: 'u1',
            platform: 'ios', runtime: 3, error: null, code: 'purchaseCancelledError'
          }
          if (typeof win.onRevenueCatResult === 'function') win.onRevenueCatResult(win.revenueCatResult)
        } else if (cmd.startsWith('getpurchasehistory://')) {
          win.restoredData = [] // EMPTY history must resolve promptly (classic pitfall)
        }
      }, 10)
    },
    configurable: true
  })
  global.window = win
  global.self = win
  const iap = freshRequire()
  assert.strictEqual(iap.runtime, 3)
  assert.strictEqual(iap.os, 'ios')
  await iap.user('u1')
  assert.strictEqual(iap.id, 'u1')

  const products = await iap.products()
  assert.strictEqual(products.length, 2)
  assert.strictEqual(products[0].priceString, '$9.99')
  assert.strictEqual(iap.project, 'proj123', 'project id auto-filled from envelope')

  // plans(): the nested paywall-screen view over the same envelope
  const plans = await iap.plans()
  assert.strictEqual(plans.length, 2)
  const monthly = plans.find((p) => p.id === 'monthly')
  const annual = plans.find((p) => p.id === 'annual')
  assert.ok(monthly && annual, 'plan ids derived from package types')
  assert.strictEqual(monthly.price.text, '$9.99')
  assert.strictEqual(monthly.price.currency, 'USD')
  assert.deepStrictEqual(monthly.period, { iso: 'P1M', value: 1, unit: 'month' })
  assert.strictEqual(monthly.trial, null)
  assert.deepStrictEqual(annual.trial, { days: 7, eligible: null }, 'P1W trial reads as 7 days')
  assert.strictEqual(annual.product, 'premium:annual')
  assert.strictEqual(annual.kind, 'annual')

  // buy() accepts the plan id and resolves it to the store product id:
  // the scheme interceptor above asserts product=premium%3Amonthly.
  const buy = await iap.buy('monthly')
  assert.strictEqual(buy.ok, true)
  assert.deepStrictEqual(buy.entitlements, ['premium'])

  const paywall = await iap.paywall()
  assert.strictEqual(paywall.cancelled, true)

  // Identity read on a build without bridge >= 2: NEVER fire the whoami
  // scheme (old catch-alls treat unknown actions as purchases), answer from
  // local state instead.
  const who = await iap.user()
  assert.strictEqual(who.user, 'u1')
  assert.strictEqual(who.registered, true)
  assert.ok(!fired.some((c) => c.startsWith('revenuecat://whoami')), 'whoami never fired without bridge proof')

  const t0 = Date.now()
  const restore = await iap.restore()
  assert.ok(Date.now() - t0 < 5000, 'empty history resolves promptly, not on timeout')
  assert.deepStrictEqual(restore.purchases, [])

  const status = await iap.status()
  assert.deepStrictEqual(status.active, ['premium'])
  assert.strictEqual(await iap.has('premium'), true)
  assert.strictEqual(await iap.has('nope'), false)

  // Deferred session bind: once envelopes proved the build, the native login
  // fired for the identified user, and never before the first envelope.
  await new Promise((r) => setTimeout(r, 250))
  assert.ok(fired.some((c) => c.startsWith('revenuecat://login?external_id=u1')), 'native login fired after capability proof')
  const firstEnvelopeCmd = fired.findIndex((c) => c.startsWith('revenuecat://products'))
  const loginCmd = fired.findIndex((c) => c.startsWith('revenuecat://login'))
  assert.ok(loginCmd > firstEnvelopeCmd, 'login only after an envelope answered')

  // Offer-code redemption on a build that acks it.
  const red = await iap.redeem()
  assert.strictEqual(red.supported, true)
  assert.strictEqual(red.ok, true)

  // Logout clears local identity AND rotates the native user on proven builds,
  // and the identity change reaches on('user') subscribers.
  const userEvents = []
  const offUser = iap.on('user', (u) => userEvents.push(u))
  await iap.logout()
  assert.strictEqual(iap.id, null)
  await new Promise((r) => setTimeout(r, 250))
  assert.ok(fired.some((c) => c === 'revenuecat://logout'), 'native logout fired on proven build')
  assert.ok(userEvents.some((u) => u && u.anonymous === true), "on('user') saw the logout envelope")
  offUser()
  console.log('  v3: products/buy/paywall/restore/status/has + login/logout/redeem bridge ✓')
}

async function testV3OldBuild () {
  // A shipped V3 binary WITHOUT the new products/customer bridge: only
  // getpurchasehistory:// answers. products() must time out to [] and
  // has() must fall back to store history.
  const win = {
    navigator: { userAgent: 'despia-android' },
    localStorage: null
  }
  Object.defineProperty(win, 'despia', {
    set (cmd) {
      setTimeout(() => {
        if (cmd.startsWith('getpurchasehistory://')) {
          win.restoredData = [{ productId: 'p1', entitlementId: 'premium', isActive: true, type: 'subscription' }]
        } // everything else: silence (old build)
      }, 10)
    },
    configurable: true
  })
  global.window = win
  global.self = win
  const iap = freshRequire()
  assert.strictEqual(iap.runtime, 3)
  const status = await iap.status()  // customer times out after 8s → history fallback
  assert.deepStrictEqual(status.active, ['premium'])
  assert.strictEqual(await iap.has('premium'), true)
  const info = await iap.info()
  assert.strictEqual(info.entitlements.premium.active, true)
  assert.strictEqual(info.entitlements.premium.product, 'p1')
  console.log('  v3 old build: entitlements fall back to store history ✓')
}

async function testV3Bridge2 () {
  // A V3 build with bridge >= 2: whoami answers on the user channel, and
  // purchases/paywalls with nobody logged in ride RevenueCat's own anonymous
  // user instead of a synthesized id.
  const fired = []
  const win = {
    navigator: { userAgent: 'Mozilla/5.0 (iPhone) despia-iphone' },
    localStorage: { _s: {}, getItem (k) { return this._s[k] || null }, setItem (k, v) { this._s[k] = v } }
  }
  Object.defineProperty(win, 'despia', {
    set (cmd) {
      fired.push(cmd)
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://products')) {
          win.revenueCatProducts = Object.assign({}, envelope(3), { bridge: 2, user: '$RCAnonymousID:abc123', anonymous: true })
          if (typeof win.onRevenueCatProducts === 'function') win.onRevenueCatProducts(win.revenueCatProducts)
        } else if (cmd.startsWith('revenuecat://whoami')) {
          win.revenueCatUser = Object.assign({}, envelope(3), {
            bridge: 2, user: '$RCAnonymousID:abc123', anonymous: true, registered: false,
            new: false, entitlements: { active: [], all: [] }
          })
          if (typeof win.onRevenueCatUser === 'function') win.onRevenueCatUser(win.revenueCatUser)
        } else if (cmd.startsWith('revenuecat://purchase')) {
          assert.ok(!cmd.includes('external_id='), 'anonymous purchase on bridge 2 carries NO external_id')
          win.revenueCatResult = {
            ok: true, cancelled: false, restored: false, source: 'purchase',
            product: 'premium:monthly', transaction: 'GPA.2', entitlements: ['premium'],
            user: '$RCAnonymousID:abc123', platform: 'ios', runtime: 3, bridge: 2, error: null, code: null
          }
          if (typeof win.onRevenueCatResult === 'function') win.onRevenueCatResult(win.revenueCatResult)
        } else if (cmd.startsWith('revenuecat://launchPaywall')) {
          assert.ok(!cmd.includes('external_id='), 'anonymous paywall on bridge 2 carries NO external_id')
          win.revenueCatResult = {
            ok: false, cancelled: true, restored: false, source: 'paywall',
            product: null, transaction: null, entitlements: [],
            user: '$RCAnonymousID:abc123', platform: 'ios', runtime: 3, bridge: 2, error: null, code: null
          }
          if (typeof win.onRevenueCatResult === 'function') win.onRevenueCatResult(win.revenueCatResult)
        }
      }, 10)
    },
    configurable: true
  })
  global.window = win
  global.self = win
  const iap = freshRequire()

  // Learn the capability from the first envelope, then read identity natively.
  await iap.products()
  const who = await iap.user()
  assert.strictEqual(who.id, '$RCAnonymousID:abc123', 'raw RevenueCat anonymous id surfaces')
  assert.strictEqual(who.user, null)
  assert.strictEqual(who.anonymous, true)
  assert.strictEqual(who.registered, false)
  assert.ok(fired.some((c) => c === 'revenuecat://whoami'), 'whoami fired once bridge 2 proven')

  // Anonymous purchase + paywall: the interceptor asserts no external_id.
  const buy = await iap.buy('monthly')
  assert.strictEqual(buy.ok, true)
  const paywall = await iap.paywall()
  assert.strictEqual(paywall.cancelled, true)
  assert.ok(!('b44rc_anon' in win.localStorage._s), 'no synthesized id was minted on a bridge 2 build')
  console.log('  v3 bridge 2: native whoami + RevenueCat-anonymous purchases ✓')
}

async function testV3LegacyAnon () {
  // A proven V3 build WITHOUT bridge 2 and nobody logged in: purchases keep
  // the synthesized stable id (those builds hard-require external_id).
  const win = {
    navigator: { userAgent: 'despia-android' },
    localStorage: { _s: {}, getItem (k) { return this._s[k] || null }, setItem (k, v) { this._s[k] = v } }
  }
  Object.defineProperty(win, 'despia', {
    set (cmd) {
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://products')) {
          win.revenueCatProducts = envelope(3)   // no bridge field: legacy
          if (typeof win.onRevenueCatProducts === 'function') win.onRevenueCatProducts(win.revenueCatProducts)
        } else if (cmd.startsWith('revenuecat://purchase')) {
          assert.ok(/external_id=b44_/.test(cmd), 'legacy build purchase falls back to the synthesized id')
          win.revenueCatResult = {
            ok: true, cancelled: false, restored: false, source: 'purchase',
            product: 'premium:monthly', transaction: 'GPA.3', entitlements: ['premium'],
            user: 'b44_x', platform: 'android', runtime: 3, error: null, code: null
          }
          if (typeof win.onRevenueCatResult === 'function') win.onRevenueCatResult(win.revenueCatResult)
        }
      }, 10)
    },
    configurable: true
  })
  global.window = win
  global.self = win
  const iap = freshRequire()
  await iap.products()                       // proves the build, no bridge stamp
  const buy = await iap.buy('monthly')
  assert.strictEqual(buy.ok, true)
  assert.ok('b44rc_anon' in win.localStorage._s, 'synthesized id persisted for stable attribution')
  console.log('  v3 legacy build: anonymous purchases keep the synthesized id ✓')
}

async function testV4LegacyActions () {
  // A V4 build that predates catalog/customer/paywall: the package must fall
  // back to the older actions the module has always carried (offerings,
  // entitlements, launchPaywall) instead of giving up.
  const called = []
  const win = {
    navigator: { userAgent: 'despia-iphone' },
    native_os: 'ios',
    __dsxWire: { bound: true },
    localStorage: { _s: {}, getItem (k) { return this._s[k] || null }, setItem (k, v) { this._s[k] = v } },
    dsx: {
      module: {
        revenuecat: {
          catalog: () => { called.push('catalog'); return Promise.reject({ code: 'no_module' }) },
          customer: () => { called.push('customer'); return Promise.reject({ code: 'no_module' }) },
          paywall: () => { called.push('paywall'); return Promise.reject({ code: 'no_module' }) },
          offerings: () => {
            called.push('offerings')
            return Promise.resolve({
              current: 'default',
              all: [{
                id: 'default',
                description: 'Standard',
                packages: [{
                  id: '$rc_monthly',
                  type: 'monthly',
                  offering_id: 'default',
                  product: {
                    id: 'premium_monthly', type: 'subscription', title: 'Premium Monthly',
                    description: 'Everything', store: 'app_store',
                    price: { amount: 9.99, formatted: '$9.99', currency: 'USD' },
                    subscription: { period: 'P1M', period_unit: 'month', period_count: 1 }
                  }
                }]
              }]
            })
          },
          entitlements: () => {
            called.push('entitlements')
            return Promise.resolve({
              active: [{ id: 'premium', is_active: true, product_id: 'premium_monthly' }],
              all: [{ id: 'premium' }, { id: 'legacy_pro' }]
            })
          },
          history: () => Promise.resolve([]),
          launchPaywall: (args) => {
            called.push('launchPaywall')
            setTimeout(() => {
              win.revenueCatResult = {
                ok: true, cancelled: false, restored: false, source: 'paywall',
                product: 'premium_monthly', transaction: 'tL', entitlements: ['premium'],
                user: null, platform: 'ios', runtime: 4, error: null, code: null
              }
              if (typeof win.onRevenueCatResult === 'function') win.onRevenueCatResult(win.revenueCatResult)
            }, 30)
            return Promise.resolve({ status: 'presented', offering: 'default' })
          }
        }
      }
    }
  }
  global.window = win
  global.self = win
  const iap = freshRequire()

  // catalog is gone, offerings answers, and package placement survives.
  const plans = await iap.plans()
  assert.ok(called.includes('catalog') && called.includes('offerings'), 'catalog fell back to offerings')
  assert.strictEqual(plans.length, 1)
  assert.strictEqual(plans[0].id, 'monthly', 'plan id derived from the package type')
  assert.strictEqual(plans[0].price.text, '$9.99')
  assert.strictEqual(plans[0].rcId, '$rc_monthly', 'package placement survives the offerings fallback')

  // customer is gone, the entitlements action answers instead of store history.
  const status = await iap.status()
  assert.ok(called.includes('entitlements'), 'status fell back to the entitlements action')
  assert.deepStrictEqual(status.active, ['premium'])
  assert.ok(status.all.includes('legacy_pro'), 'inactive entitlements are reported too')
  assert.deepStrictEqual(status.subscriptions, ['premium_monthly'])
  assert.strictEqual(await iap.has('premium'), true)

  // paywall is gone, the legacy launchPaywall spelling answers.
  const paywall = await iap.paywall()
  assert.ok(called.includes('launchPaywall'), 'paywall fell back to launchPaywall')
  assert.strictEqual(paywall.ok, true)
  console.log('  v4 legacy actions: offerings + entitlements + launchPaywall fallbacks ✓')
}

async function testV3LegacyOfferings () {
  // A classic build that predates revenuecat://products: the legacy offerings
  // channel (window.offeringsData, no-argument callback) still answers, so a
  // paywall can be rendered instead of showing an empty screen.
  const fired = []
  const win = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(win, 'despia', {
    set (cmd) {
      fired.push(cmd)
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://offerings')) {
          win.offeringsData = [{
            packageId: '$rc_annual', packageType: 'ANNUAL', productId: 'premium_annual',
            title: 'Premium Annual', priceString: '$79.99', price: 79.99, currency: 'USD',
            period: { unit: 'year', value: 1, iso8601: 'P1Y' },
            pricePerUnitString: '$6.67',
            introOffer: { priceString: '$0.00', period: { unit: 'week', value: 1, iso8601: 'P1W' }, type: 'free_trial' }
          }]
          win.offeringsError = null
          if (typeof win.onRevenueCatOfferings === 'function') win.onRevenueCatOfferings()
        }
        // revenuecat://products: silence, this build predates it
      }, 10)
    },
    configurable: true
  })
  global.window = win
  global.self = win
  const iap = freshRequire()

  const plans = await iap.plans()
  assert.ok(fired.some((c) => c.startsWith('revenuecat://products')), 'the unified read is tried first')
  assert.ok(fired.some((c) => c.startsWith('revenuecat://offerings')), 'then the legacy offerings read')
  assert.strictEqual(plans.length, 1)
  assert.strictEqual(plans[0].kind, 'annual')
  assert.strictEqual(plans[0].price.text, '$79.99')
  assert.strictEqual(plans[0].product, 'premium_annual')
  assert.deepStrictEqual(plans[0].trial, { days: 7, eligible: null }, 'the legacy intro offer maps to a trial')
  console.log('  v3 legacy build: products falls back to the offerings channel ✓')
}

async function testOfferingFilterNeverWidens () {
  // Regression: on a build without `catalog`, the client-side filter used to
  // be a no-op when it matched nothing, so asking for one offering returned
  // the whole catalog. That renders a win-back price to a full-price user.
  const win = {
    navigator: { userAgent: 'despia-iphone' }, native_os: 'ios', __dsxWire: {}, localStorage: null,
    dsx: { module: { revenuecat: {
      catalog: () => Promise.reject({ code: 'no_module' }),
      offerings: () => Promise.resolve({ current: 'default', all: [
        { id: 'default', packages: [{ id: '$rc_monthly', type: 'monthly', product: { id: 'full_9', title: 'Full', price: { amount: 9.99, formatted: '$9.99' }, subscription: { period: 'P1M', period_unit: 'month', period_count: 1 } } }] },
        { id: 'winback', packages: [{ id: '$rc_monthly', type: 'monthly', product: { id: 'win_4', title: 'Winback', price: { amount: 4.99, formatted: '$4.99' }, subscription: { period: 'P1M', period_unit: 'month', period_count: 1 } } }] }
      ] })
    } } }
  }
  global.window = win
  global.self = win
  const iap = freshRequire()

  const missing = await iap.plans('blackfriday')
  assert.deepStrictEqual(missing, [], 'an unknown offering returns nothing, never the whole catalog')
  const envelope = await iap.offers('blackfriday')
  assert.strictEqual(envelope.ok, false)
  assert.strictEqual(envelope.code, 'offeringNotFoundError', 'and says why, like the native catalog does')

  const hit = await iap.plans('winback')
  assert.strictEqual(hit.length, 1, 'a known offering returns only its own plans')
  assert.strictEqual(hit[0].price.text, '$4.99')
  console.log('  offering filter: an unknown id never widens to the full catalog ✓')
}

async function testEmptyEntitlementsFallsThrough () {
  // Regression: an empty {active:[],all:[]} is truthy, so it used to outrank
  // the store history and a live subscriber read as not entitled.
  const win = {
    navigator: { userAgent: 'despia-android' }, native_os: 'android', __dsxWire: {}, localStorage: null,
    dsx: { module: { revenuecat: {
      customer: () => Promise.reject({ code: 'no_module' }),
      entitlements: () => Promise.resolve({ active: [], all: [] }),
      history: () => Promise.resolve([{ productId: 'premium_monthly', entitlementId: 'premium', isActive: true, type: 'subscription' }])
    } } }
  }
  global.window = win
  global.self = win
  const iap = freshRequire()

  const status = await iap.status()
  assert.deepStrictEqual(status.active, ['premium'], 'store history still answers when entitlements are empty')
  assert.strictEqual(await iap.has('premium'), true, 'a live subscriber keeps access')
  console.log('  empty entitlements: store history still answers, subscriber keeps access ✓')
}

async function testModuleExcludedFailsFast () {
  // Regression: the bus wait gated on the wire, which every Framework surface
  // has, so a build that simply excludes RevenueCat waited 2s per call.
  const win = {
    navigator: { userAgent: 'despia-iphone' }, native_os: 'ios', __dsxWire: {}, localStorage: null,
    dsx: { module: { dom: {}, app: {} } }        // bus bound, revenuecat not in this build
  }
  global.window = win
  global.self = win
  const iap = freshRequire()

  const t0 = Date.now()
  const envelope = await iap.offers()
  const elapsed = Date.now() - t0
  assert.strictEqual(envelope.code, 'no_module')
  // Generous bound on purpose: the invariant is "did not wait out the 2s bus
  // wait", not a benchmark. A tight threshold only flakes on a loaded runner.
  assert.ok(elapsed < 1500, 'a bound bus without the module answers immediately, took ' + elapsed + 'ms')
  console.log('  module excluded: answers immediately instead of waiting for a bound bus ✓')
}

async function testLegacyIntroOfferFidelity () {
  // Regression: the legacy offerings channel reports only a display string and
  // a payment mode, so inventing price 0 / cycles 1 made every paid intro
  // offer read as a zero-price pay-up-front.
  const win = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(win, 'despia', {
    set (cmd) {
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://offerings')) {
          win.offeringsData = [{
            packageId: '$rc_annual', packageType: 'ANNUAL', productId: 'premium_annual',
            title: 'Premium Annual', priceString: '$79.99', price: 79.99, currency: 'USD',
            period: { unit: 'year', value: 1, iso8601: 'P1Y' },
            introOffer: { priceString: '$1.99', period: { unit: 'month', value: 1, iso8601: 'P1M' }, type: 'pay_as_you_go' }
          }]
          win.offeringsError = null
          if (typeof win.onRevenueCatOfferings === 'function') win.onRevenueCatOfferings()
        }
      }, 10)
    },
    configurable: true
  })
  global.window = win
  global.self = win
  const iap = freshRequire()

  const plans = await iap.plans()
  assert.strictEqual(plans.length, 1)
  assert.strictEqual(plans[0].intro.type, 'payg', 'the native payment mode survives, not a cycles guess')
  assert.strictEqual(plans[0].intro.price.text, '$1.99', 'the display string is the truth')
  assert.strictEqual(plans[0].intro.price.value, null, 'unknown price stays null in the plan shape too, never 0')
  const products = await iap.products()
  assert.strictEqual(products[0].intro.price, null, 'no numeric price is invented')
  assert.strictEqual(products[0].intro.cycles, null, 'no cycle count is invented')
  console.log('  legacy intro offer: mode preserved, nothing invented ✓')
}

async function testBusArrivesLate () {
  // The Framework locks window.__dsxWire at document start and binds the
  // window.dsx bus a moment later. A call made in that gap must wait for the
  // bus, not resolve an empty paywall on a perfectly capable app.
  const win = {
    navigator: { userAgent: 'despia-iphone' },
    native_os: 'ios',
    __dsxWire: { bound: false },
    localStorage: null
  }
  global.window = win
  global.self = win
  const iap = freshRequire()
  assert.strictEqual(iap.runtime, 4, 'the wire alone identifies the Framework')

  // The bus binds 300ms after the call is already in flight.
  setTimeout(() => {
    win.dsx = {
      module: {
        revenuecat: {
          catalog: () => Promise.resolve(envelope(4))
        }
      }
    }
  }, 300)

  const t0 = Date.now()
  const products = await iap.products()
  assert.strictEqual(products.length, 2, 'the call waited for the bus instead of failing')
  assert.ok(Date.now() - t0 >= 250, 'it really did wait')

  // A page that is not the Framework at all must not wait: no wire, no bus.
  const bare = { navigator: { userAgent: 'Mozilla/5.0' }, localStorage: null }
  global.window = bare
  global.self = bare
  const web = freshRequire()
  const t1 = Date.now()
  await web.products()
  assert.ok(Date.now() - t1 < 1500, 'a plain browser resolves immediately, no bus wait')
  console.log('  late bus: a call made before window.dsx binds still works ✓')
}

async function testEntitlementLifecycleState () {
  // Current builds report per-entitlement lifecycle state natively. info()
  // must use it verbatim, because it expresses things the device's store
  // history cannot: a cancellation still inside the paid period, and a
  // billing retry.
  const detail = {
    premium: {
      active: true, product: 'premium_monthly', period: 'trial', renews: false,
      bought: '2026-01-04T10:00:00Z', first: '2025-11-04T10:00:00Z',
      expires: '2026-02-04T10:00:00Z',
      unsubscribed: '2026-01-20T09:00:00Z', billingIssue: null,
      store: 'app_store', ownership: 'purchased', sandbox: false
    }
  }
  const win = {
    navigator: { userAgent: 'despia-iphone' }, native_os: 'ios', __dsxWire: {}, localStorage: null,
    dsx: { module: { revenuecat: {
      customer: () => Promise.resolve(Object.assign(envelope(4), {
        entitlements: { active: ['premium'], all: ['premium'] },
        subscriptions: ['premium_monthly'], management: null, details: detail
      })),
      history: () => Promise.resolve([])
    } } }
  }
  global.window = win
  global.self = win
  const iap = freshRequire()

  const info = await iap.info()
  const p = info.entitlements.premium
  assert.strictEqual(p.active, true)
  assert.strictEqual(p.renews, false, 'auto-renew is off')
  assert.strictEqual(p.unsubscribed, '2026-01-20T09:00:00Z', 'cancelled but still inside the paid period')
  assert.strictEqual(p.period, 'trial')
  assert.strictEqual(p.store, 'app_store')
  assert.strictEqual(p.expires, '2026-02-04T10:00:00Z')
  // The distinction the id arrays could never express: still entitled, but
  // leaving. That is exactly when a win-back offer is worth showing.
  assert.ok(p.active && !p.renews && p.unsubscribed, 'active, not renewing, cancellation known')

  // A build that does not report details must still answer the old way.
  const legacyWin = {
    navigator: { userAgent: 'despia-android' }, native_os: 'android', __dsxWire: {}, localStorage: null,
    dsx: { module: { revenuecat: {
      customer: () => Promise.resolve(Object.assign(envelope(4), {
        entitlements: { active: ['premium'], all: ['premium'] }, subscriptions: [], management: null
      })),
      history: () => Promise.resolve([{ productId: 'premium_monthly', entitlementId: 'premium', isActive: true, willRenew: true, purchaseDate: '2026-01-04T10:00:00Z', expirationDate: '2026-02-04T10:00:00Z' }])
    } } }
  }
  global.window = legacyWin
  global.self = legacyWin
  const legacy = freshRequire()
  const oldInfo = await legacy.info()
  assert.strictEqual(oldInfo.entitlements.premium.active, true, 'older build still answers')
  assert.strictEqual(oldInfo.entitlements.premium.product, 'premium_monthly', 'inferred from store history')
  console.log('  entitlement lifecycle: native state wins, older builds still answer ✓')
}

async function testRuntimeDetection () {
  // The module bus alone is enough to mean Framework: the wire flag and the
  // bus are not guaranteed to appear in the same tick, and misreading a
  // Framework app as classic would fire scheme navigations at it.
  // A Despia app with a page-defined window.dsx but NO wire is the classic
  // runtime: the Framework installs the wire at document start and locks it,
  // so its absence is decisive. Trusting the writable global here would
  // silently disable every purchase on a classic build.
  const spoofed = {
    navigator: { userAgent: 'despia-iphone' },
    dsx: { module: { revenuecat: {} } },
    localStorage: null
  }
  global.window = spoofed
  global.self = spoofed
  assert.strictEqual(freshRequire().runtime, 3, 'a page-defined dsx cannot turn a classic app into a Framework one')

  // Off-device, with no Despia user agent, the bus is the only signal there is.
  const webBus = { navigator: { userAgent: 'Mozilla/5.0' }, dsx: { module: { revenuecat: {} } }, localStorage: null }
  global.window = webBus
  global.self = webBus
  assert.strictEqual(freshRequire().runtime, 4, 'a non-native Framework surface still speaks the bus')

  const wireOnly = { navigator: { userAgent: 'despia-android' }, __dsxWire: {}, localStorage: null }
  global.window = wireOnly
  global.self = wireOnly
  assert.strictEqual(freshRequire().runtime, 4, 'the locked wire alone is decisive')

  const classic = { navigator: { userAgent: 'Mozilla/5.0 (iPhone) despia-iphone' }, localStorage: null }
  global.window = classic
  global.self = classic
  assert.strictEqual(freshRequire().runtime, 3, 'despia user agent alone is the classic runtime')

  const browser = { navigator: { userAgent: 'Mozilla/5.0' }, localStorage: null }
  global.window = browser
  global.self = browser
  assert.strictEqual(freshRequire().runtime, 0, 'a plain browser is neither')
  console.log('  runtime detection: bus, wire, user agent, and browser ✓')
}

async function testDestructured () {
  // A natural (and AI-generated) usage shape: pull the methods off the module.
  global.window = { navigator: { userAgent: 'Mozilla/5.0' }, localStorage: null }
  global.self = global.window
  const revenuecat = freshRequire()
  const { user, plans, buy, has, restore, logout } = revenuecat
  await user('u1')
  assert.strictEqual(revenuecat.id, 'u1', 'destructured user() still binds identity')
  assert.deepStrictEqual(await plans(), [])
  assert.strictEqual((await buy('x')).ok, false)
  assert.strictEqual(await has('premium'), false)
  assert.deepStrictEqual((await restore()).active, [])
  await logout()
  assert.strictEqual(revenuecat.id, null)
  console.log('  destructured methods keep working (no `this` crash) ✓')
}

async function testRedeemStub () {
  // Android never supports the redemption sheet; iOS on an old build resolves
  // {supported:false} after the silent probe.
  const win = { navigator: { userAgent: 'despia-android' }, localStorage: null }
  Object.defineProperty(win, 'despia', { set () {}, configurable: true })
  global.window = win
  global.self = win
  const iap = freshRequire()
  const red = await iap.redeem()
  assert.strictEqual(red.supported, false)
  console.log('  redeem: unsupported resolves cleanly, never crashes ✓')
}

const FUTURE_MS = Date.now() + 365 * 86400000

async function testServer () {
  const calls = []
  const SUBSCRIBER = {
    entitlements: {
      premium: { expires_date: null, product_identifier: 'premium:monthly' },
      old: { expires_date: '2020-01-01T00:00:00Z' }
    },
    first_seen: '2026-01-01T00:00:00Z'
  }
  global.fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization, signal: init.signal, headers: init.headers })
    if (url.includes('/v1/subscribers/')) {
      return { ok: true, status: 200, json: async () => ({ subscriber: SUBSCRIBER }) }
    }
    if (url.includes('/projects/projBroken/')) {
      return { ok: false, status: 401, json: async () => ({}) }
    }
    if (url.includes('/projects/projLimited/')) {
      // RevenueCat sends Retry-After with a 429; callers should back off for
      // the interval it asks for rather than guessing.
      return { ok: false, status: 429, headers: { get: (h) => (h.toLowerCase() === 'retry-after' ? '42' : null) }, json: async () => ({}) }
    }
    if (url.includes('/projects/projMissing/')) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    if (url.includes('/customers/u404/')) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    if (url.includes('/projects/projNew/customers/') && url.includes('active_entitlements')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ entitlement_id: 'entlNEW', expires_at: null }] }) }
    }
    if (url.includes('/projects/projPaged/customers/') && url.includes('active_entitlements')) {
      if (url.includes('starting_after')) {
        // v2 reports expires_at as EPOCH MILLISECONDS (per the API
        // reference), not an ISO string: the mapper must convert it. Use a
        // FUTURE timestamp — a past one would encode the expectation that an
        // expired entitlement is active.
        return { ok: true, status: 200, json: async () => ({ items: [{ entitlement_id: 'entl2', expires_at: FUTURE_MS }] }) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [{ entitlement_id: 'entl123', expires_at: null }],
          next_page: '/v2/projects/projPaged/customers/u1/active_entitlements?limit=100&starting_after=entl123'
        })
      }
    }
    if (url.includes('/customers/') && url.includes('active_entitlements')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ entitlement_id: 'entl123', expires_at: null }] }) }
    }
    if (url.includes('/projects/projNew/entitlements?')) {
      // First read predates the new entitlement; a refresh knows about it.
      projNewReads++
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: projNewReads > 1 ? [{ id: 'entlNEW', lookup_key: 'premium' }] : [{ id: 'entlOLD', lookup_key: 'legacy' }] })
      }
    }
    if (url.includes('/entitlements?')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 'entl123', lookup_key: 'premium' }, { id: 'entl2', lookup_key: 'plus' }] }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  let projNewReads = 0
  function freshServer () {
    delete require.cache[require.resolve('./server.cjs')]
    return require('./server.cjs')
  }
  let server = freshServer()

  // Zero-secret: a public SDK key authenticates the v1 subscribers endpoint.
  // (That endpoint is create-on-read upstream: an unseen id becomes a
  // customer with no entitlements, so gates still deny correctly.)
  assert.strictEqual(await server.entitled('u1', 'premium', { key: 'appl_pub' }), true)
  assert.strictEqual(await server.entitled('u1', 'old', { key: 'appl_pub' }), false, 'expired entitlement is inactive')
  assert.ok(calls[0].url.includes('/v1/subscribers/u1'))
  assert.strictEqual(calls[0].auth, 'Bearer appl_pub')
  assert.ok(calls.every((c) => c.signal), 'every request carries an abort signal (timeout)')

  // Secret + project: v2 path with the entl->lookup_key join.
  calls.length = 0
  const ents = await server.entitlements('u1', { secret: 'sk_test', project: 'proj123' })
  assert.deepStrictEqual(ents, [{ id: 'premium', expires: null }])
  assert.ok(calls[0].url.includes('/v2/projects/proj123/customers/u1/active_entitlements'))

  // A public key never attempts v2, with or without a project id: only
  // sk_... keys are valid there.
  calls.length = 0
  await server.entitled('u1', 'premium', { key: 'appl_pub', project: 'proj123' })
  assert.ok(calls.every((c) => c.url.includes('/v1/')), 'public key stays on v1')

  // v2 404 on the customer with a VALID project: the project-scoped
  // entitlements list (cached) proves the project id is good, so the
  // customer is simply unseen → no entitlements, no v1 fallback.
  calls.length = 0
  assert.deepStrictEqual(await server.entitlements('u404', { secret: 'sk_test', project: 'proj123' }), [])
  assert.ok(calls.every((c) => c.url.includes('/v2/')), 'unseen customer stays on v2')

  // v2 404 because the PROJECT id is wrong: the disambiguation read 404s
  // too → fall back to v1 (and remember), never silently deny a subscriber.
  calls.length = 0
  assert.strictEqual(await server.entitled('u1', 'premium', { secret: 'sk_test', project: 'projMissing' }), true)
  assert.ok(calls.some((c) => c.url.includes('/v1/subscribers/')), 'wrong project fell back to v1')
  calls.length = 0
  await server.entitled('u1', 'premium', { secret: 'sk_test', project: 'projMissing' })
  assert.strictEqual(calls.filter((c) => c.url.includes('/v2/')).length, 0, 'wrong project remembered, straight to v1')

  // v2 pagination: active_entitlements follows next_page, and epoch-ms
  // expires_at values convert to ISO.
  calls.length = 0
  const paged = await server.entitlements('u1', { secret: 'sk_test', project: 'projPaged' })
  assert.deepStrictEqual(paged.map((e) => e.id).sort(), ['plus', 'premium'])
  const plusEnt = paged.find((e) => e.id === 'plus')
  assert.strictEqual(plusEnt.expires, new Date(FUTURE_MS).toISOString(), 'epoch-ms expires_at converts to ISO')

  // An entitlement created after the lookup-key map was cached must not read
  // as a raw "entl..." id (which would deny a paying subscriber until the
  // cache expired): a miss refreshes the map once.
  calls.length = 0
  const fresh = await server.entitlements('u1', { secret: 'sk_test', project: 'projNew' })
  assert.deepStrictEqual(fresh, [{ id: 'premium', expires: null }], 'unknown entitlement id refreshes the lookup map')
  assert.strictEqual(projNewReads, 2, 'exactly one refresh, not a loop')

  // v2 key/project mismatch (401): falls back to v1 and remembers, so the
  // second call skips v2 entirely.
  calls.length = 0
  assert.strictEqual(await server.entitled('u1', 'premium', { secret: 'sk_test', project: 'projBroken' }), true)
  assert.ok(calls.some((c) => c.url.includes('/v1/subscribers/')), '401 fell back to v1')
  const v2AttemptsFirst = calls.filter((c) => c.url.includes('/v2/')).length
  calls.length = 0
  await server.entitled('u1', 'premium', { secret: 'sk_test', project: 'projBroken' })
  assert.strictEqual(calls.filter((c) => c.url.includes('/v2/')).length, 0, 'broken v2 remembered, straight to v1')
  assert.strictEqual(v2AttemptsFirst, 1, 'only one v2 probe ever spent')

  // 429 rate limit: surfaces to the caller instead of burning a v1 request,
  // and carries the interval RevenueCat asked us to wait.
  calls.length = 0
  await assert.rejects(
    () => server.entitled('u1', 'premium', { secret: 'sk_test', project: 'projLimited' }),
    (e) => e.status === 429 && e.retryAfter === 42,
    '429 must throw with .status and the Retry-After interval, not fall back'
  )
  assert.ok(!calls.some((c) => c.url.includes('/v1/')), 'no v1 request spent on a rate limit')

  // Sandbox: RevenueCat answers with PRODUCTION purchases only unless the
  // X-Is-Sandbox header is set, so a TestFlight purchase would be invisible
  // to the gate. Opt-in only — production calls must never carry it.
  calls.length = 0
  await server.entitled('u1', 'premium', { key: 'appl_pub' })
  assert.ok(!calls[0].headers['X-Is-Sandbox'], 'production calls never claim sandbox')
  calls.length = 0
  await server.entitled('u1', 'premium', { key: 'appl_pub', sandbox: true })
  assert.strictEqual(calls[0].headers['X-Is-Sandbox'], 'true', 'sandbox opt-in sends the header')
  // X-Platform must never be sent: it would stamp the customer's last_seen
  // on a server verification the user did not make.
  assert.ok(!calls[0].headers['X-Platform'], 'never stamps last_seen via X-Platform')
  calls.length = 0
  process.env.RC_SANDBOX = 'true'
  await server.entitled('u1', 'premium', { key: 'appl_pub' })
  assert.strictEqual(calls[0].headers['X-Is-Sandbox'], 'true', 'RC_SANDBOX=true opts in')
  delete process.env.RC_SANDBOX
  calls.length = 0
  process.env.RC_SANDBOX = 'false'
  await server.entitled('u1', 'premium', { key: 'appl_pub' })
  assert.ok(!calls[0].headers['X-Is-Sandbox'], 'RC_SANDBOX=false stays on production')
  delete process.env.RC_SANDBOX

  // customer(): raw v1 subscriber snapshot.
  const snap = await server.customer('u1', { key: 'appl_pub' })
  assert.strictEqual(snap.first_seen, '2026-01-01T00:00:00Z')
  assert.strictEqual(await server.customer('', { key: 'appl_pub' }), null, 'falsy user resolves null')

  // Missing key: throws with a pointer to the fix (fail closed).
  server = freshServer()
  const savedEnv = {}
  for (const k of ['RC_KEY', 'RC_SECRET', 'REVENUECAT_PUBLIC_KEY', 'REVENUECAT_SECRET_KEY']) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  await assert.rejects(() => server.entitled('u1', 'premium'), /missing RevenueCat API key/)

  // Env resolution: RC_KEY, then the REVENUECAT_* alias.
  calls.length = 0
  process.env.RC_KEY = 'appl_env'
  assert.strictEqual(await server.entitled('u1', 'premium'), true)
  assert.strictEqual(calls[0].auth, 'Bearer appl_env')
  delete process.env.RC_KEY
  calls.length = 0
  process.env.REVENUECAT_PUBLIC_KEY = 'appl_alias'
  assert.strictEqual(await server.entitled('u1', 'premium'), true)
  assert.strictEqual(calls[0].auth, 'Bearer appl_alias')
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }

  console.log('  server: v1/v2 paths, honest fallback, pagination, env keys, fail-closed throws ✓')
}

async function testMultiOfferingPricing () {
  // A project with more than one offering is RevenueCat's NORMAL state
  // (experiments, promos, win-back, legacy prices). plans() must describe ONE
  // offering — the current one — or a non-current offering's package claims
  // the canonical short id like 'monthly' and buy(plans[0].id) charges its
  // SKU at its price.
  function P (id, price, offering) {
    return {
      id: id, sku: id, plan: null, type: 'subscription', title: id, desc: '',
      price: price, priceString: '$' + price, currency: 'USD',
      period: 'P1M', periodUnit: 'month', periodCount: 1, intro: null,
      offering: offering, package: '$rc_monthly', packageType: 'monthly'
    }
  }
  const BF = P('premium_monthly_bf', 2.99, 'blackfriday')
  const DEF = P('premium_monthly', 9.99, 'default')
  const full = {
    ok: true, runtime: 4, current: 'default', user: null,
    offerings: [
      { id: 'blackfriday', current: false, packages: [{ id: '$rc_monthly', type: 'monthly', product: BF }] },
      { id: 'default', current: true, packages: [{ id: '$rc_monthly', type: 'monthly', product: DEF }] }
    ],
    products: [BF, DEF], error: null, code: null
  }
  const bought = []
  const win = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  win.dsx = {
    module: {
      revenuecat: {
        catalog: (a) => {
          if (!a.offering) return Promise.resolve(full)
          const kept = full.offerings.filter((o) => o.id === a.offering)
          return Promise.resolve(Object.assign({}, full, { offerings: kept, products: kept.flatMap((o) => o.packages.map((p) => p.product)) }))
        },
        purchase: (a) => { bought.push(a.product); return Promise.resolve({ status: 'purchased', product_id: a.product }) }
      }
    }
  }
  global.window = win
  global.self = win
  const iap = freshRequire()

  const plans = await iap.plans()
  assert.strictEqual(plans.length, 1, 'plans() describes one offering, not every offering in the project')
  assert.strictEqual(plans[0].product, 'premium_monthly', 'plans() uses the CURRENT offering')
  assert.strictEqual(plans[0].price.value, 9.99, 'the current offering keeps its real price')
  assert.strictEqual(plans[0].id, 'monthly', 'the current offering keeps the canonical short id')
  await iap.buy(plans[0].id)
  assert.strictEqual(bought[0], 'premium_monthly', 'buy(plans[0].id) charges the current offering, not a promo SKU')

  // An explicit filter still wins over `current`.
  bought.length = 0
  const promo = await iap.plans('blackfriday')
  assert.strictEqual(promo[0].product, 'premium_monthly_bf', 'an explicit offering filter is honored')
  assert.strictEqual(promo[0].id, 'monthly', 'the filtered offering keeps the canonical id too')

  // THE MONEY TEST: an unrelated catalog read between rendering a promo
  // paywall and buying must not repoint the short id at a different SKU.
  // The user is charged what they were shown, or the package is broken.
  await iap.products()                      // a prefetch / another screen
  await iap.buy('monthly')
  assert.strictEqual(bought[0], 'premium_monthly_bf', 'the price shown is the price charged, even after an unrelated catalog read')

  // Switching users still drops every cached scope.
  await iap.user('someone-else')
  assert.deepStrictEqual(iap._catalogs, {}, 'an identity change clears every cached offering scope')
  console.log('  multi-offering: plans() scoped, and the price shown is the price charged ✓')
}

async function testTerminalErrorsSettleFast () {
  // center() must not hold a caller for the sheet window on a terminal
  // native error. not_ready is the likeliest one in practice: the SDK
  // configures at launch, so an early "Manage subscription" tap hits it.
  for (const code of ['not_ready', 'no_activity', 'offerings_failed']) {
    const win = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
    win.dsx = { module: { revenuecat: { center: () => Promise.reject({ code }) } } }
    global.window = win
    global.self = win
    const iap = freshRequire()
    const t0 = Date.now()
    const r = await iap.center()
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.code, code, `center() surfaces ${code} instead of hanging`)
    assert.ok(Date.now() - t0 < iap._t.sheet, 'settles immediately, not on the sheet timeout')
  }

  // redeem() on a capable classic build must work as the FIRST call.
  const fired = []
  const win3 = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(win3, 'despia', {
    set (cmd) {
      fired.push(cmd)
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://products')) {
          win3.revenueCatProducts = envelope(3)
          if (typeof win3.onRevenueCatProducts === 'function') win3.onRevenueCatProducts(win3.revenueCatProducts)
        } else if (cmd.startsWith('revenuecat://redeem')) {
          win3.revenueCatResult = { ok: true, source: 'redeem', code: null }
          if (typeof win3.onRevenueCatResult === 'function') win3.onRevenueCatResult(win3.revenueCatResult)
        }
      }, 10)
    },
    configurable: true
  })
  global.window = win3
  global.self = win3
  const iap3 = freshRequire()
  const red = await iap3.redeem()
  assert.strictEqual(red.supported, true, 'redeem() probes the bridge instead of answering unsupported on a cold first call')
  console.log('  terminal errors settle immediately; redeem() probes on a cold start ✓')
}

async function testCatalogShapeInvariants () {
  // Two packages of the SAME type in one offering: their ids must not
  // collide, or buy(id) becomes ambiguous and charges whichever won.
  function P (id, pkg, type, price, count) {
    return {
      id: id, sku: id, plan: null, type: 'subscription', title: id, desc: '',
      price: price, priceString: '$' + price, currency: 'USD',
      period: 'P1M', periodUnit: 'month', periodCount: count === undefined ? 1 : count,
      intro: null, offering: 'default', package: pkg, packageType: type
    }
  }
  const A = P('m_a', '$rc_monthly', 'monthly', 9.99)
  const B = P('m_b', '$rc_monthly_promo', 'monthly', 4.99)
  const NOCOUNT = P('quarterly', '$rc_custom', 'custom', 19.99, null)
  const env = {
    ok: true, runtime: 4, current: 'default', user: null,
    offerings: [{ id: 'default', current: true, packages: [
      { id: '$rc_monthly', type: 'monthly', product: A },
      { id: '$rc_monthly_promo', type: 'monthly', product: B },
      { id: '$rc_custom', type: 'custom', product: NOCOUNT }
    ] }],
    products: [A, B, NOCOUNT], error: null, code: null
  }
  const bought = []
  const win = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  win.dsx = {
    module: {
      revenuecat: {
        catalog: () => Promise.resolve(env),
        purchase: (a) => { bought.push(a.product); return Promise.resolve({ status: 'purchased', product_id: 'STORE_CONFIRMED', active_entitlements: ['premium'] }) },
        logout: () => { bought.push('LOGOUT'); return Promise.resolve({}) }
      }
    }
  }
  global.window = win
  global.self = win
  const iap = freshRequire()
  const plans = await iap.plans()
  const ids = plans.map((p) => p.id)
  assert.strictEqual(new Set(ids).size, ids.length, 'two packages of one type never collide on a plan id')
  // '$rc_' prefixes are stripped so ids stay human ('monthly', not '$rc_monthly').
  assert.ok(ids.every((i) => i.indexOf('$rc_') !== 0), 'plan ids never carry the raw $rc_ prefix')
  // Colliding plans are disambiguated by their PACKAGE ids (readable, and
  // what a paywall keys off), not by falling back to raw store product ids.
  assert.ok(ids.includes('monthly'), 'the first colliding plan keeps the readable package id')
  assert.ok(ids.includes('monthly_promo'), 'the second colliding plan uses its own package id, not the store product id')
  // A product reporting no period count must not invent one.
  const q = plans.find((p) => p.product === 'quarterly')
  assert.strictEqual(q.period.value, 1, 'a missing period count defaults to 1, not an invented number')

  // The result reports what the STORE confirmed, not what we asked for.
  const r = await iap.buy(plans[0].id)
  assert.strictEqual(r.product, 'STORE_CONFIRMED', 'buy() reports the product the store confirmed')

  // logout() reaches the native layer so the RevenueCat user actually rotates.
  await iap.logout()
  await new Promise((r2) => setTimeout(r2, 50))
  assert.ok(bought.includes('LOGOUT'), 'logout() calls the native logout action')

  // Offers are forwarded on both runtimes (they are inert natively today, but
  // dropping them silently would hide the day that changes).
  bought.length = 0
  const args = []
  win.dsx.module.revenuecat.purchase = (a) => { args.push(a); return Promise.resolve({ status: 'purchased', product_id: a.product }) }
  await iap.plans()
  await iap.buy(plans[0].id, { offer: 'winback50' })
  assert.strictEqual(args[0].offer, 'winback50', 'V4 buy() forwards options.offer')

  const fired = []
  const win3 = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(win3, 'despia', {
    set (cmd) {
      fired.push(cmd)
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://products')) {
          win3.revenueCatProducts = envelope(3)
          if (typeof win3.onRevenueCatProducts === 'function') win3.onRevenueCatProducts(win3.revenueCatProducts)
        } else if (cmd.startsWith('revenuecat://purchase')) {
          const res = { ok: true, source: 'purchase', product: 'premium:monthly', transaction: 'T', entitlements: [], code: null }
          win3.revenueCatResult = res
          if (typeof win3.onRevenueCatResult === 'function') win3.onRevenueCatResult(res)
        }
      }, 10)
    },
    configurable: true
  })
  global.window = win3
  global.self = win3
  const iap3 = freshRequire()
  await iap3.user('u1')
  await iap3.buy('monthly', { offer: 'winback50' })
  const purchaseCmd = fired.find((c) => c.startsWith('revenuecat://purchase'))
  assert.ok(purchaseCmd.includes('offer=winback50'), 'V3 buy() forwards options.offer')
  assert.ok(purchaseCmd.includes('external_id=u1'), 'V3 buy() still carries the bound user id')
  console.log('  catalog shape: unique ids, stripped prefixes, store-confirmed product, offers forwarded ✓')
}

// ── the resolution matrix ────────────────────────────────────────────────
// The five "a paying subscriber reads as not entitled" releases were each a
// single cell of this table, found one at a time. Testing the scenarios that
// were once bugs catches regressions; it does not catch the sixth instance.
// So generate the whole cross product and assert the property instead:
//
//   IF ANY SOURCE IN THE LADDER SAYS POSITIVE, THE ANSWER IS POSITIVE.
//
// The table is generated, not enumerated: adding a 6th source to SOURCES adds
// its four answers to every combination automatically.
const ANSWERS = ['POSITIVE', 'NEGATIVE', 'EMPTY', 'ERROR']

// Each source knows how to produce a native reply for a given answer. `null`
// for ERROR means "this call rejects".
const SOURCES = [
  {
    name: 'customer',
    // Two POSITIVE shapes, because a build may report entitlement state as the
    // `entitlements` summary OR as the per-entitlement `details` map. The
    // matrix originally only modelled the summary, which is exactly why it did
    // not catch a resolver that classified from `details` and then built
    // active[] from the summary — winning the ladder and reporting nothing.
    positiveShapes: [
      () => ({ ok: true, entitlements: { active: ['premium'], all: ['premium'] }, user: 'u1', anonymous: false }),
      () => ({ ok: true, details: { premium: { active: true } }, user: 'u1', anonymous: false })
    ],
    reply: {
      POSITIVE: () => ({ ok: true, entitlements: { active: ['premium'], all: ['premium'] }, user: 'u1', anonymous: false }),
      // Knows about the entitlement, reports it inactive. This is the case
      // that must NOT outrank a lower source saying active.
      NEGATIVE: () => ({ ok: true, entitlements: { active: [], all: ['premium'] }, user: 'u1', anonymous: false }),
      // A bare ack: implemented the action, carries no entitlement state.
      EMPTY: () => ({}),
      ERROR: null
    }
  },
  {
    name: 'entitlements',
    reply: {
      POSITIVE: () => ({ active: [{ id: 'premium', product_id: 'p' }], all: [{ id: 'premium' }] }),
      NEGATIVE: () => ({ active: [], all: [{ id: 'premium' }] }),
      EMPTY: () => ({ active: [], all: [] }),
      ERROR: null
    }
  },
  {
    name: 'history',
    reply: {
      POSITIVE: () => ([{ productId: 'premium_monthly', entitlementId: 'premium', isActive: true, type: 'subscription' }]),
      NEGATIVE: () => ([{ productId: 'premium_monthly', entitlementId: 'premium', isActive: false, type: 'subscription' }]),
      EMPTY: () => ([]),
      ERROR: null
    }
  }
]

function cartesian (lists) {
  return lists.reduce(
    (acc, list) => acc.flatMap((row) => list.map((v) => row.concat([v]))),
    [[]]
  )
}

async function testResolutionMatrix () {
  const combos = cartesian(SOURCES.map(() => ANSWERS))
  let checked = 0
  let positives = 0

  // Each combination is run once per POSITIVE shape a source declares, so a
  // second way of expressing "granting" is covered everywhere the first is.
  const shapeCount = Math.max(...SOURCES.map((s) => (s.positiveShapes || [null]).length))
  for (const combo of combos) {
   for (let shape = 0; shape < shapeCount; shape++) {
    const mod = {}
    SOURCES.forEach((src, i) => {
      const answer = combo[i]
      let make = src.reply[answer]
      if (answer === 'POSITIVE' && src.positiveShapes) {
        make = src.positiveShapes[Math.min(shape, src.positiveShapes.length - 1)]
      }
      mod[src.name] = make
        ? () => Promise.resolve(make())
        : () => Promise.reject({ code: 'unknown_action' })
    })

    const win = {
      navigator: { userAgent: 'despia-iphone' }, native_os: 'ios',
      __dsxWire: {}, localStorage: null,
      dsx: { module: { revenuecat: mod } }
    }
    global.window = win
    global.self = win
    const iap = freshRequire()

    const label = SOURCES.map((s, i) => `${s.name}=${combo[i]}`).join(' ')
    const anyPositive = combo.indexOf('POSITIVE') !== -1

    const status = await iap.status()
    const has = await iap.has('premium')

    // THE PROPERTY. Every historical bug is a cell where this failed.
    if (anyPositive) {
      assert.strictEqual(
        has, true,
        `a POSITIVE source must never be outranked into a denial [${label}]`
      )
      assert.ok(
        status.active.indexOf('premium') !== -1,
        `active[] must carry the entitlement some source reported active [${label}]`
      )
      positives++
    } else {
      // Nothing anywhere said active, so denying is the only correct answer.
      assert.strictEqual(
        has, false,
        `no source reported an active entitlement, so the gate must deny [${label}]`
      )
    }

    // Rule 2: an errored source is skipped, never read as a denial. Every
    // combination must still produce a well-formed status rather than throw.
    assert.strictEqual(typeof status.ok, 'boolean', `status stays well-formed [${label}]`)
    assert.ok(Array.isArray(status.active) && Array.isArray(status.all), `arrays stay arrays [${label}]`)
    checked++
   }
  }

  // Guard the generator itself: if a refactor makes cartesian() return a
  // trivial table, the property above would pass vacuously.
  assert.strictEqual(checked, Math.pow(ANSWERS.length, SOURCES.length) * shapeCount, 'every cell ran, once per positive shape')
  assert.ok(positives > 0 && positives < checked, 'the table contains both outcomes')
  console.log(`  resolution matrix: ${checked} source/answer/shape combinations, any-POSITIVE-wins holds ✓`)
}

// Rule 5, as its own property: a source that did not decide still contributes
// its metadata. This is 1.6.0 behaviour and regressing it is silent.
async function testNonDecidingSourceKeepsMetadata () {
  const win = {
    navigator: { userAgent: 'despia-iphone' }, native_os: 'ios',
    __dsxWire: {}, localStorage: null,
    dsx: { module: { revenuecat: {
      // Envelope carries metadata but no entitlement state: it must not
      // decide, and its metadata must survive onto the deciding answer.
      customer: () => Promise.resolve({
        ok: true, user: 'u1', anonymous: false,
        management: 'https://apps.apple.com/manage',
        subscriptions: [{ id: 'premium_monthly' }]
      }),
      entitlements: () => Promise.reject({ code: 'unknown_action' }),
      history: () => Promise.resolve([
        { productId: 'premium_monthly', entitlementId: 'premium', isActive: true, type: 'subscription' }
      ])
    } } }
  }
  global.window = win
  global.self = win
  const iap = freshRequire()

  const s = await iap.status()
  assert.deepStrictEqual(s.active, ['premium'], 'the deciding source answered')
  assert.strictEqual(s.management, 'https://apps.apple.com/manage', 'manage link rides along from the non-deciding envelope')
  assert.deepStrictEqual(s.subscriptions, [{ id: 'premium_monthly' }], 'subscriptions ride along')
  assert.strictEqual(s.user, 'u1', 'identity rides along')
  console.log('  non-deciding source still contributes metadata (rule 5) ✓')
}

// The matrix asserts grant-vs-deny. These pin the EMPTY/NEGATIVE distinction
// itself, which the matrix cannot see because both outcomes deny: what differs
// is WHICH source decides, and therefore which metadata the caller gets back.
// That matters on the denial path specifically — a lapsed subscriber is denied
// and still needs the `management` link and the entitlement ids to resubscribe.
async function testEmptyVersusNegativeClassification () {
  const build = (mod) => {
    const win = {
      navigator: { userAgent: 'despia-iphone' }, native_os: 'ios',
      __dsxWire: {}, localStorage: null,
      dsx: { module: { revenuecat: mod } }
    }
    global.window = win
    global.self = win
    return freshRequire()
  }
  const INACTIVE = [{ productId: 'premium_monthly', entitlementId: 'premium', isActive: false, type: 'subscription' }]

  // 1. `details: {}` is a bare ack, not an authoritative "none active". It is
  //    EMPTY, so the store history — which does know about premium — decides.
  let iap = build({
    customer: () => Promise.resolve({ ok: true, details: {}, subscriptions: [{ id: 's1' }] }),
    entitlements: () => Promise.reject({ code: 'unknown_action' }),
    history: () => Promise.resolve(INACTIVE)
  })
  let s = await iap.status()
  assert.deepStrictEqual(s.all, ['premium'], 'an empty details map must not decide; history knows the entitlement')
  assert.deepStrictEqual(s.subscriptions, [{ id: 's1' }], 'the non-deciding envelope still contributes metadata')

  // 2. A details map WITH content and nothing active is a real NEGATIVE: the
  //    build is reporting state, and it outranks the lower rungs. The two
  //    sources name DIFFERENT entitlements so the assertion can tell which one
  //    actually decided.
  iap = build({
    customer: () => Promise.resolve({ ok: true, details: { legacy: { active: false } }, subscriptions: [{ id: 's1' }] }),
    entitlements: () => Promise.reject({ code: 'unknown_action' }),
    history: () => Promise.resolve(INACTIVE)                     // knows 'premium'
  })
  s = await iap.status()
  assert.deepStrictEqual(s.active, [], 'nothing is active either way')
  assert.deepStrictEqual(s.all, ['legacy'], 'the populated details map decided, not the store history')

  // 2b. And when that details map DOES report something active, the envelope
  //     must actually say so. classifyEnvelope reads `details`, so the status
  //     it produces has to read it too — otherwise the top rung wins the
  //     ladder and then reports nothing, denying a paying subscriber.
  iap = build({
    customer: () => Promise.resolve({ ok: true, details: { premium: { active: true } } }),
    entitlements: () => Promise.reject({ code: 'unknown_action' }),
    history: () => Promise.resolve([])
  })
  s = await iap.status()
  assert.deepStrictEqual(s.active, ['premium'], 'a details-only envelope that grants must report the grant')
  assert.strictEqual(await iap.has('premium'), true, 'and the gate opens')

  // 3. History rows that are all inactive are NEGATIVE, not EMPTY: the device
  //    knows about this entitlement, so it outranks an empty entitlements read.
  iap = build({
    customer: () => Promise.reject({ code: 'unknown_action' }),
    entitlements: () => Promise.resolve({ active: [], all: [] }),
    history: () => Promise.resolve(INACTIVE)
  })
  s = await iap.status()
  assert.deepStrictEqual(s.all, ['premium'], 'inactive history rows still report which entitlement is known')
  assert.strictEqual(await iap.has('premium'), false, 'and it is still a denial')

  console.log('  EMPTY vs NEGATIVE: bare acks never decide, real state always does ✓')
}

// ── money-path invariants ────────────────────────────────────────────────
// This class does not fail loudly and does not fail in your own account: the
// user sees one price and is charged another. Stated as properties over the
// whole catalog rather than as the two cases that were once bugs.
async function testMoneyPathInvariants () {
  const PROMO = {
    id: 'premium:monthly:promo', sku: 'premium', plan: 'monthly', type: 'subscription',
    title: 'Premium Monthly (Black Friday)', desc: 'Half off', price: 4.99, priceString: '$4.99',
    currency: 'USD', period: 'P1M', periodUnit: 'month', periodCount: 1,
    intro: null, offering: 'blackfriday', package: '$rc_monthly', packageType: 'monthly'
  }
  const catalog = (offering) => {
    const all = {
      default: { id: 'default', current: true, packages: [
        { id: '$rc_monthly', type: 'monthly', product: PRODUCT },
        { id: '$rc_annual', type: 'annual', product: ANNUAL }
      ] },
      blackfriday: { id: 'blackfriday', current: false, packages: [
        { id: '$rc_monthly', type: 'monthly', product: PROMO }
      ] }
    }
    // Deliberately IGNORES the offering filter, like a build that predates
    // native filtering: the client-side narrowing in offers() is then the only
    // thing standing between a typo and the default offering's pricing, which
    // is exactly the protection worth testing.
    const picked = Object.values(all)
    return {
      ok: true, provider: 'revenuecat', platform: 'ios', runtime: 4,
      project: 'proj123', user: 'u1', anonymous: false, current: 'default',
      offerings: picked,
      products: picked.flatMap((o) => o.packages.map((p) => p.product)),
      error: null, code: null
    }
  }
  let bought = null
  let calls = 0
  const build = () => {
    const win = {
      navigator: { userAgent: 'despia-iphone' }, native_os: 'ios',
      __dsxWire: {}, localStorage: null,
      dsx: { module: { revenuecat: {
        catalog: ({ offering } = {}) => { calls++; return Promise.resolve(catalog(offering)) },
        purchase: (args) => { bought = args.product; return Promise.resolve({ ok: true, product_id: args.product }) },
        customer: () => Promise.reject({ code: 'unknown_action' }),
        entitlements: () => Promise.reject({ code: 'unknown_action' }),
        history: () => Promise.resolve([])
      } } }
    }
    global.window = win
    global.self = win
    return freshRequire()
  }

  // INVARIANT 1: render/charge identity. Over EVERY plan in a rendered
  // offering, the product buy() resolves is the product the price came from.
  for (const offering of ['default', 'blackfriday']) {
    const iap = build()
    const plans = await iap.plans(offering)
    assert.ok(plans.length > 0, `${offering} rendered at least one plan`)
    for (const p of plans) {
      bought = null
      await iap.buy(p.id)
      assert.strictEqual(
        bought, p.product,
        `buy(${p.id}) must charge the product its price.text was rendered from [${offering}]`
      )
      // And the price shown belongs to that same product, not a sibling.
      const src = catalog(offering).products.find((x) => x.id === p.product)
      assert.strictEqual(p.price.text, src.priceString, `rendered price belongs to the charged product [${offering}]`)
    }
  }

  // INVARIANT 2: offering isolation. A plan rendered from one offering can
  // never be purchased out of another. The promo and the full price share the
  // package id '$rc_monthly', which is exactly how a promo price gets shown
  // while the full price is charged.
  let iap = build()
  const promo = await iap.plans('blackfriday')
  assert.strictEqual(promo[0].price.text, '$4.99', 'promo offering renders the promo price')
  bought = null
  await iap.buy('$rc_monthly')
  assert.strictEqual(bought, 'premium:monthly:promo', 'a bare package id buys from the RENDERED offering, not the default one')

  // The reverse direction, to prove it is scope and not luck.
  iap = build()
  await iap.plans('default')
  bought = null
  await iap.buy('$rc_monthly')
  assert.strictEqual(bought, 'premium:monthly', 'rendering the default offering charges the default price')

  // INVARIANT 3: a misspelled offering never widens scope. plans() errors and
  // paywall() must not quietly fall back to the default offering's pricing.
  iap = build()
  const typo = await iap.plans('blackfridy')
  assert.deepStrictEqual(typo, [], 'a misspelled offering renders no plans')
  const pw = await iap.paywall('blackfridy')
  assert.strictEqual(pw.ok, false, 'a misspelled offering does not present a paywall')
  assert.strictEqual(pw.code, 'offeringNotFoundError', 'and it says why, instead of showing default pricing')

  // A real offering still presents.
  iap = build()
  const ok = await iap.paywall('blackfriday')
  assert.notStrictEqual(ok.code, 'offeringNotFoundError', 'a real offering is still presented')

  // And the check is answered from an already-rendered catalog when there is
  // one, so the common path costs no extra native call. Rendering the full
  // catalog first proves the typo is caught from cache, not from a re-read.
  iap = build()
  await iap.plans()
  const before = calls
  const cached = await iap.paywall('blackfridy')
  assert.strictEqual(cached.code, 'offeringNotFoundError', 'a cached catalog refuses a missing offering too')
  assert.strictEqual(calls, before, 'and answers from cache without another catalog read')

  // INVARIANT 4: a build whose catalog read degrades to the flat product list
  // cannot name offerings at all. plans() already refuses a named offering
  // there — it cannot know which flat products belong to it — so paywall()
  // refuses the same input, and the two stay consistent. The bare paywall()
  // is unaffected, because nothing was named and nothing can mismatch.
  // (Contrast with an offerings list that exists but is UNLABELLED, and with a
  // catalog read that throws: both are "no evidence" and still present.)
  const degraded = {
    navigator: { userAgent: 'despia-iphone' }, native_os: 'ios',
    __dsxWire: {}, localStorage: null,
    dsx: { module: { revenuecat: {
      catalog: () => Promise.reject({ code: 'unknown_action' }),
      offerings: () => Promise.reject({ code: 'unknown_action' }),
      products: () => Promise.resolve([{ id: 'premium:monthly', price: 9.99, priceString: '$9.99' }]),
      purchase: (args) => Promise.resolve({ ok: true, product_id: args.product }),
      customer: () => Promise.reject({ code: 'unknown_action' }),
      entitlements: () => Promise.reject({ code: 'unknown_action' }),
      history: () => Promise.resolve([])
    } } }
  }
  global.window = degraded
  global.self = degraded
  iap = freshRequire()
  // plans() already refuses here — it cannot know which flat products belong
  // to the named offering — so paywall() refusing the same input is the
  // consistent answer, and the alternative is showing default pricing under a
  // promo's name.
  const degradedPlans = await iap.plans('blackfriday')
  assert.deepStrictEqual(degradedPlans, [], 'a degraded catalog cannot render a named offering')
  const unverifiable = await iap.paywall('blackfriday')
  assert.strictEqual(
    unverifiable.code, 'offeringNotFoundError',
    'and paywall() refuses exactly what plans() refuses, rather than falling back to default pricing'
  )

  // The bare paywall still works on that same build: no offering was named,
  // so there is nothing to mismatch.
  const bare = await iap.paywall()
  assert.notStrictEqual(bare.code, 'offeringNotFoundError', 'the default paywall is unaffected')

  // INVARIANT 5: an UNLABELLED offerings list is not evidence of absence. The
  // legacy V3 offerings channel cannot name what it returned and labels its
  // single offering `id: ''` even when the native side honoured the filter.
  // Treating that as "your offering is missing" refuses every named offering
  // on classic builds — the paywall simply never opens and the sale is lost.
  const legacy = {
    navigator: { userAgent: 'Mozilla/5.0 (iPhone) despia-iphone' }, localStorage: null
  }
  global.window = legacy
  global.self = legacy
  iap = freshRequire()
  const fired = []
  Object.defineProperty(legacy, 'despia', { set (cmd) { fired.push(cmd) }, get () { return '' } })
  iap._catalogs[''] = {
    envelope: { ok: true, offerings: [{ id: '', current: true, packages: [] }], products: [{ id: 'p' }] },
    plans: []
  }
  const legacyResult = iap.paywall('blackfriday')
  // The check falls through to a catalog read (an unlabelled list proves
  // nothing), which is raced against T.probe and then presents. Wait past that
  // budget rather than sampling before the race resolves.
  await new Promise((r) => setTimeout(r, 700))
  assert.ok(
    fired.some((u) => u.indexOf('launchPaywall') !== -1),
    'an unlabelled offerings list must not refuse a named offering — the paywall has to open'
  )
  legacyResult.catch(() => {})

  console.log('  money path: render/charge identity, offering isolation, no silent widening ✓')
}

// whoami(): which RevenueCat customer is this device, and did a migration
// actually land? The migration case is the reason it exists — an anonymous
// device buying, then the user signing in, must end up as ONE customer.
async function testWhoami () {
  // V4, anonymous: RevenueCat minted its own id, purchases attach to the
  // device rather than to an account.
  let win = {
    navigator: { userAgent: 'despia-iphone' }, native_os: 'ios', __dsxWire: {}, localStorage: null,
    dsx: { module: { revenuecat: {
      whoami: () => Promise.resolve({ app_user_id: '$RCAnonymousID:ab12', is_anonymous: true })
    } } }
  }
  global.window = win; global.self = win
  let iap = freshRequire()
  let me = await iap.whoami()
  assert.strictEqual(me.anonymous, true, 'an anonymous device reports anonymous')
  assert.strictEqual(me.registered, false, 'and not registered')
  assert.strictEqual(me.id, '$RCAnonymousID:ab12', 'the RevenueCat-minted id is surfaced')
  assert.strictEqual(me.source, 'native', 'the native SDK answered')

  // THE MIGRATION: anonymous device → signed-in account. user(id) must call
  // the native login (which merges the anonymous purchase history), and a
  // follow-up whoami() must report the new identity, not the old one.
  const logins = []
  let identity = { app_user_id: '$RCAnonymousID:ab12', is_anonymous: true }
  win = {
    navigator: { userAgent: 'despia-iphone' }, native_os: 'ios', __dsxWire: {}, localStorage: null,
    dsx: { module: { revenuecat: {
      whoami: () => Promise.resolve(identity),
      login: ({ external_id }) => {
        logins.push(external_id)
        identity = { app_user_id: external_id, is_anonymous: false }
        return Promise.resolve({ ok: true })
      }
    } } }
  }
  global.window = win; global.self = win
  iap = freshRequire()
  assert.strictEqual((await iap.whoami()).anonymous, true, 'starts anonymous')
  await iap.user('user_234')
  await new Promise((r) => setTimeout(r, 20))            // login is fire-and-forget
  assert.deepStrictEqual(logins, ['user_234'], 'user(id) calls the native login so history merges')
  me = await iap.whoami()
  assert.strictEqual(me.registered, true, 'the device is now a registered customer')
  assert.strictEqual(me.user, 'user_234', 'and it is the account we migrated to')
  assert.strictEqual(me.anonymous, false, 'no longer anonymous')

  // ACCOUNT SWITCH on a shared device: 123 → 234. The catalog cached for the
  // first account must not price the second.
  await iap.user('user_123')
  await iap.plans().catch(() => {})
  await iap.user('user_234')
  assert.deepStrictEqual(iap._catalogs, {}, 'switching accounts drops the previous catalog')

  // V3 bridge >= 2 answers the same question over the scheme channel.
  win = {
    navigator: { userAgent: 'despia-iphone' }, native_os: 'ios', localStorage: null,
    setTimeout: setTimeout, clearTimeout: clearTimeout
  }
  global.window = win; global.self = win
  iap = freshRequire()
  iap._bridge = 2
  const v3 = iap.whoami()
  await new Promise((r) => setTimeout(r, 10))
  win.revenueCatUser = { ok: true, user: 'user_777', anonymous: false }
  if (typeof win.onRevenueCatUser === 'function') win.onRevenueCatUser(win.revenueCatUser)
  const got = await v3
  assert.strictEqual(got.source, 'native', 'V3 bridge>=2 has a real identity read')

  // A build with NO identity read must say so rather than claiming anonymous:
  // "we could not ask" and "nobody is signed in" are different answers.
  win = { navigator: { userAgent: 'despia-iphone' }, native_os: 'ios', localStorage: null }
  global.window = win; global.self = win
  iap = freshRequire()
  iap._bridge = 1
  const legacy = await iap.whoami()
  assert.strictEqual(legacy.source, 'local', 'an old build reports a local answer, not a native one')

  // The browser preview is neither.
  win = { navigator: { userAgent: 'Mozilla/5.0' }, localStorage: null }
  global.window = win; global.self = win
  iap = freshRequire()
  assert.strictEqual((await iap.whoami()).source, 'web', 'the browser preview says web')

  console.log('  whoami: anonymous vs registered, migration merges, switch clears catalog, source is honest ✓')
}

async function testStatusSourceInvariants () {
  // historyStatus: only rows the store says are ACTIVE may appear in active[].
  const win = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  win.dsx = {
    module: {
      revenuecat: {
        customer: () => Promise.reject({ code: 'unknown_action' }),
        entitlements: () => Promise.reject({ code: 'unknown_action' }),
        history: () => Promise.resolve([
          { productId: 'p1', entitlementId: 'live', isActive: true, willRenew: true, entitlement: { period_type: 'promotional' } },
          { productId: 'p2', entitlementId: 'dead', isActive: false, willRenew: false }
        ])
      }
    }
  }
  global.window = win
  global.self = win
  let iap = freshRequire()
  let s = await iap.status()
  assert.deepStrictEqual(s.active, ['live'], 'only store-active rows are active')
  assert.deepStrictEqual(s.all.sort(), ['dead', 'live'], 'every seen entitlement appears in all')
  const info = await iap.info()
  assert.strictEqual(info.entitlements.live.period, 'promo', "period_type 'promotional' maps to 'promo'")

  // entitlementsStatus: duplicate ids from the native list are de-duplicated.
  const win2 = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  win2.dsx = {
    module: {
      revenuecat: {
        customer: () => Promise.reject({ code: 'unknown_action' }),
        history: () => Promise.resolve([]),
        entitlements: () => Promise.resolve({
          active: [{ id: 'premium', product_id: 'p' }, { id: 'premium', product_id: 'p' }],
          all: [{ id: 'premium' }]
        })
      }
    }
  }
  global.window = win2
  global.self = win2
  iap = freshRequire()
  s = await iap.status()
  assert.deepStrictEqual(s.active, ['premium'], 'a duplicated entitlement is reported once')

  // An envelope whose details object is EMPTY carries no entitlement state,
  // so it must not outrank a store history that shows an active subscription.
  const win3 = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  win3.dsx = {
    module: {
      revenuecat: {
        customer: () => Promise.resolve({ ok: true, runtime: 4, entitlements: { active: [], all: [] }, details: {} }),
        entitlements: () => Promise.resolve({ active: [], all: [] }),
        history: () => Promise.resolve([{ productId: 'p', entitlementId: 'premium', isActive: true }])
      }
    }
  }
  global.window = win3
  global.self = win3
  iap = freshRequire()
  assert.strictEqual(await iap.has('premium'), true, 'an empty details object never masks the store history')
  console.log('  status sources: active-only, de-duplicated, empty details never masks history ✓')
}

async function testServerIdentityAndMatching () {
  // The whole point of the server module is that the client cannot be
  // trusted, so the gate must read the entitlements of the user it was ASKED
  // about — with a mock that answers differently per user, not one subscriber
  // for everybody.
  const seen = []
  const PEOPLE = {
    subscriber_1: { pro: { expires_date: null }, pro_trial: { expires_date: null } },
    freeloader: {}
  }
  global.fetch = async (url, init) => {
    seen.push(url)
    const m = url.match(/\/v1\/subscribers\/([^/?]+)/)
    const who = m ? decodeURIComponent(m[1]) : null
    if (who) {
      const ents = PEOPLE[who]
      if (!ents) return { ok: false, status: 404, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => ({ subscriber: { entitlements: ents } }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  delete require.cache[require.resolve('./server.cjs')]
  const server = require('./server.cjs')
  const key = { key: 'appl_pub' }

  assert.strictEqual(await server.entitled('subscriber_1', 'pro', key), true, 'the real subscriber is entitled')
  assert.strictEqual(await server.entitled('freeloader', 'pro', key), false, "another user's subscription never leaks across")
  assert.ok(seen.some((u) => u.includes('/freeloader')), 'the request actually asked about the user passed in')

  // Entitlement ids are matched EXACTLY. A gate for 'pro' must not be
  // satisfied by holding 'pro_trial', and vice versa.
  assert.strictEqual(await server.entitled('subscriber_1', 'pro_trial', key), true)
  assert.strictEqual(await server.entitled('subscriber_1', 'p', key), false, 'a prefix of an entitlement id never passes the gate')
  assert.strictEqual(await server.entitled('subscriber_1', 'pro_trial_extra', key), false, 'a longer id never passes either')

  // A blank/undefined user id must deny, never inherit somebody else's answer.
  for (const bad of ['', null, undefined]) {
    assert.deepStrictEqual(await server.entitlements(bad, key), [], 'a falsy user id yields no entitlements')
    assert.strictEqual(await server.entitled(bad, 'pro', key), false, 'a falsy user id is never entitled')
  }

  // The configured timeout must reach the request, not just "a signal exists".
  let seenMs = null
  const realTimeout = AbortSignal.timeout
  AbortSignal.timeout = (ms) => { seenMs = ms; return realTimeout.call(AbortSignal, ms) }
  try {
    await server.entitled('subscriber_1', 'pro', { key: 'appl_pub', timeout: 4321 })
    assert.strictEqual(seenMs, 4321, 'the configured timeout is the one actually applied')
    await server.entitled('subscriber_1', 'pro', { key: 'appl_pub' })
    assert.strictEqual(seenMs, 10000, 'the documented 10s default is the one actually applied')
  } finally {
    AbortSignal.timeout = realTimeout
  }

  // secret wins over key when both are supplied, as documented.
  delete require.cache[require.resolve('./server.cjs')]
  const s2 = require('./server.cjs')
  seen.length = 0
  const auths = []
  const prev = global.fetch
  global.fetch = async (url, init) => { auths.push(init.headers.Authorization); return prev(url, init) }
  await s2.entitled('subscriber_1', 'pro', { key: 'appl_pub', secret: 'sk_wins' })
  assert.strictEqual(auths[0], 'Bearer sk_wins', 'secret wins over key when both are set')
  global.fetch = prev

  console.log('  server identity: right user, exact id match, real timeout, secret precedence ✓')
}

async function testServerCacheAndEncoding () {
  const calls = []
  let listPages = 0
  global.fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization })
    if (url.includes('/v1/subscribers/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          subscriber: {
            entitlements: {
              premium: { expires_date: null },
              // No expires_date key at all: an unrecognised shape, NOT a
              // lifetime grant. Must never pass the gate.
              mystery: { product_identifier: 'p' }
            }
          }
        })
      }
    }
    // A key that v2 rejects, and a healthy one, on the SAME project.
    if (url.includes('/v2/') && init.headers.Authorization === 'Bearer sk_bad') {
      return { ok: false, status: 403, json: async () => ({}) }
    }
    if (url.includes('/projects/proj%20one/entitlements')) {
      // Two pages, so the paging loop must actually iterate.
      listPages++
      if (url.includes('starting_after')) {
        return { ok: true, status: 200, json: async () => ({ items: [{ id: 'entl2', lookup_key: 'premium' }] }) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [{ id: 'entl1', lookup_key: 'basic' }], next_page: '/v2/projects/proj%20one/entitlements?limit=100&starting_after=entl1' })
      }
    }
    if (url.includes('/projects/proj%20one/customers/') && url.includes('active_entitlements')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ entitlement_id: 'entl2', expires_at: FUTURE_MS }] }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  delete require.cache[require.resolve('./server.cjs')]
  const server = require('./server.cjs')

  // An entitlement with no expiry FIELD is not a lifetime grant: deny.
  assert.strictEqual(await server.entitled('u1', 'premium', { key: 'appl_pub' }), true, 'expires_date: null is a lifetime grant')
  assert.strictEqual(await server.entitled('u1', 'mystery', { key: 'appl_pub' }), false, 'an entitlement with no expiry field never grants access')

  // Project ids are URL-encoded, and the entitlements list pages fully, so a
  // lookup key on page 2 still resolves.
  calls.length = 0
  listPages = 0
  const ents = await server.entitlements('u1', { secret: 'sk_good', project: 'proj one' })
  assert.ok(calls.every((c) => !c.url.includes('proj one')), 'the project id is URL-encoded, never sent raw')
  assert.strictEqual(listPages, 2, 'the entitlements list is paged all the way through')
  assert.deepStrictEqual(ents, [{ id: 'premium', expires: new Date(FUTURE_MS).toISOString() }], 'a lookup key found on page 2 still resolves')

  // The v2 downgrade is remembered per KEY, not per project: a bad key must
  // not disable v2 for a healthy key on the same project.
  calls.length = 0
  await server.entitled('u1', 'premium', { secret: 'sk_bad', project: 'proj one' })
  assert.ok(calls.some((c) => c.url.includes('/v1/')), 'the rejected key falls back to v1')
  calls.length = 0
  await server.entitled('u1', 'premium', { secret: 'sk_good', project: 'proj one' })
  assert.ok(calls.some((c) => c.url.includes('/v2/')), 'a healthy key on the same project still uses v2')
  console.log('  server cache/encoding: per-key downgrade, full paging, encoded ids, no phantom lifetimes ✓')
}

async function testLapsedAndPlanResolution () {
  // The most common real-world state a gate must get right: an entitlement
  // the customer USED to have. It stays in `all` forever and must never
  // satisfy has().
  const win = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  win.dsx = {
    module: {
      revenuecat: {
        customer: () => Promise.resolve({
          ok: true,
          runtime: 4,
          entitlements: { active: ['basic'], all: ['basic', 'premium'] },
          subscriptions: [],
          details: { basic: { active: true }, premium: { active: false, expires: '2020-01-01T00:00:00Z' } }
        }),
        history: () => Promise.resolve([])
      }
    }
  }
  global.window = win
  global.self = win
  let iap = freshRequire()
  assert.strictEqual(await iap.has('basic'), true, 'an active entitlement passes')
  assert.strictEqual(await iap.has('premium'), false, 'a LAPSED entitlement (in all, not active) must never pass')
  const info = await iap.info()
  assert.strictEqual(info.entitlements.premium.active, false, 'info() reports the lapsed entitlement as inactive')
  assert.strictEqual(info.entitlements.basic.active, true)

  // buy() must resolve the plan the caller named, not simply the first one.
  const bought = []
  const win2 = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  win2.dsx = {
    module: {
      revenuecat: {
        catalog: () => Promise.resolve(envelope(4)),
        purchase: (a) => { bought.push(a.product); return Promise.resolve({ status: 'purchased', product_id: a.product, active_entitlements: ['premium'] }) }
      }
    }
  }
  global.window = win2
  global.self = win2
  iap = freshRequire()
  const plans = await iap.plans()
  const annual = plans.find((p) => p.id === 'annual')
  const r = await iap.buy(annual.id)
  assert.strictEqual(bought[0], 'premium:annual', 'buy() charges the plan that was named, not plans[0]')
  assert.strictEqual(r.product, 'premium:annual', 'the result reports the product the store confirmed')
  assert.deepStrictEqual(r.entitlements, ['premium'], 'the result carries the entitlements the store returned')

  const monthly = plans.find((p) => p.id === 'monthly')
  assert.strictEqual(monthly.price.value, 9.99, 'the numeric price survives the unified envelope')
  assert.strictEqual(monthly.price.currency, 'USD', 'the currency survives the unified envelope')

  // The RC-flavored mapper (older builds without `catalog`, falling back to
  // `offerings`/`products`) must preserve the numeric price and currency too:
  // a zeroed price renders as "free" and a null currency breaks formatting.
  const win3 = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  win3.dsx = {
    module: {
      revenuecat: {
        catalog: () => Promise.reject({ code: 'unknown_action' }),
        offerings: () => Promise.reject({ code: 'unknown_action' }),
        products: () => Promise.resolve([{
          id: 'premium:monthly',
          type: 'subscription',
          title: 'Premium Monthly',
          description: 'All of it',
          price: { amount: 12.5, formatted: '$12.50', currency: 'CAD' },
          subscription: { period: 'P1M', period_unit: 'month', period_count: 1 },
          introductory_offer: { price: { amount: 2.5, formatted: '$2.50' }, period_unit: 'month', period_count: 1, cycles: 3, payment_mode: 'pay_as_you_go' }
        }])
      }
    }
  }
  global.window = win3
  global.self = win3
  iap = freshRequire()
  const mapped = await iap.products()
  assert.strictEqual(mapped[0].price, 12.5, 'the RC-flavored mapper keeps the numeric price')
  assert.strictEqual(mapped[0].currency, 'CAD', 'the RC-flavored mapper keeps the currency')
  const mappedPlans = await iap.plans()
  assert.strictEqual(mappedPlans[0].price.value, 12.5, 'the mapped numeric price reaches plans()')
  assert.strictEqual(mappedPlans[0].intro.type, 'payg', 'a multi-cycle intro is pay-as-you-go, not pay-up-front')

  // info() on a build with NO per-entitlement details falls back to inferring
  // from store history — that path must report a lapsed entitlement as
  // inactive just as the native-details path does.
  const win4 = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  win4.dsx = {
    module: {
      revenuecat: {
        customer: () => Promise.resolve({
          ok: true,
          runtime: 4,
          entitlements: { active: ['basic'], all: ['basic', 'premium'] },
          subscriptions: []
        }),
        history: () => Promise.resolve([
          { productId: 'p_basic', entitlementId: 'basic', isActive: true, willRenew: true, purchaseDate: '2026-01-01T00:00:00Z', expirationDate: '2027-01-01T00:00:00Z' },
          { productId: 'p_prem', entitlementId: 'premium', isActive: false, willRenew: false, purchaseDate: '2020-01-01T00:00:00Z', expirationDate: '2021-01-01T00:00:00Z' }
        ])
      }
    }
  }
  global.window = win4
  global.self = win4
  iap = freshRequire()
  const inferred = await iap.info()
  assert.strictEqual(inferred.entitlements.basic.active, true, 'inference path: active entitlement is active')
  assert.strictEqual(inferred.entitlements.premium.active, false, 'inference path: a LAPSED entitlement is not active')
  assert.strictEqual(inferred.entitlements.premium.expires, '2021-01-01T00:00:00Z', 'inference path reports the real expiry')
  assert.strictEqual(inferred.entitlements.basic.renews, true, 'inference path reports the real renewal state')
  assert.strictEqual(inferred.entitlements.premium.renews, false)
  console.log('  lapsed entitlements denied on both info() paths; mapped prices survive ✓')
}

async function testSharedResultChannelIsolation () {
  // buy() and paywall() share ONE native result channel. Each must take only
  // its own outcome, or dismissing a paywall resolves an in-flight purchase
  // as a successful sale.
  const win = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(win, 'despia', {
    set (cmd) {
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://products')) {
          win.revenueCatProducts = envelope(3)
          if (typeof win.onRevenueCatProducts === 'function') win.onRevenueCatProducts(win.revenueCatProducts)
        } else if (cmd.startsWith('revenuecat://launchPaywall')) {
          // The paywall is dismissed without buying.
          const r = { ok: false, cancelled: true, source: 'paywall', product: null, transaction: null, entitlements: [], code: 'purchaseCancelledError' }
          win.revenueCatResult = r
          if (typeof win.onRevenueCatResult === 'function') win.onRevenueCatResult(r)
        } else if (cmd.startsWith('revenuecat://purchase')) {
          const r = { ok: true, cancelled: false, source: 'purchase', product: 'premium:monthly', transaction: 'T1', entitlements: ['premium'], code: null }
          win.revenueCatResult = r
          if (typeof win.onRevenueCatResult === 'function') win.onRevenueCatResult(r)
        }
      }, 15)
    },
    configurable: true
  })
  global.window = win
  global.self = win
  const iap = freshRequire()
  await iap.products()
  const [pw, buy] = await Promise.all([iap.paywall(), iap.buy('monthly')])
  assert.strictEqual(pw.source, 'paywall', 'the paywall takes the paywall outcome')
  assert.strictEqual(pw.cancelled, true)
  assert.strictEqual(buy.source, 'purchase', 'the purchase takes the purchase outcome')
  assert.strictEqual(buy.ok, true, 'a dismissed paywall never resolves an in-flight buy() as a sale')
  assert.strictEqual(buy.product, 'premium:monthly')

  // The real hazard: a STRAY paywall outcome landing on the shared channel
  // while a purchase is in flight (a late dismissal, a duplicate emit). The
  // purchase must ignore it and wait for its own result, or the app records a
  // sale the store never made — or reports a cancel on a completed purchase.
  const win2 = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(win2, 'despia', {
    set (cmd) {
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://products')) {
          win2.revenueCatProducts = envelope(3)
          if (typeof win2.onRevenueCatProducts === 'function') win2.onRevenueCatProducts(win2.revenueCatProducts)
        } else if (cmd.startsWith('revenuecat://purchase')) {
          // A late paywall dismissal arrives FIRST, on the same channel.
          const stray = { ok: false, cancelled: true, source: 'paywall', product: null, transaction: null, entitlements: [], code: 'purchaseCancelledError' }
          win2.revenueCatResult = stray
          if (typeof win2.onRevenueCatResult === 'function') win2.onRevenueCatResult(stray)
          setTimeout(() => {
            const real = { ok: true, cancelled: false, source: 'purchase', product: 'premium:monthly', transaction: 'T9', entitlements: ['premium'], code: null }
            win2.revenueCatResult = real
            if (typeof win2.onRevenueCatResult === 'function') win2.onRevenueCatResult(real)
          }, 40)
        }
      }, 15)
    },
    configurable: true
  })
  global.window = win2
  global.self = win2
  const iap2 = freshRequire()
  await iap2.products()
  const solo = await iap2.buy('monthly')
  assert.strictEqual(solo.source, 'purchase', 'a stray paywall outcome never settles an in-flight purchase')
  assert.strictEqual(solo.ok, true)
  assert.strictEqual(solo.transaction, 'T9', 'the purchase resolves with its OWN store transaction')
  console.log('  shared result channel: buy() and paywall() never take each other\'s outcome ✓')
}

async function testAnonIdStability () {
  // Anonymous purchases made before login must all belong to ONE RevenueCat
  // customer on this device, or pre-signup revenue scatters.
  const store = {}
  const win = {
    navigator: { userAgent: 'despia-iphone' },
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) } }
  }
  Object.defineProperty(win, 'despia', { set () {}, configurable: true })
  global.window = win
  global.self = win
  const iap = freshRequire()
  const first = iap._anon()
  assert.ok(/^b44_/.test(first), 'a synthesized id is generated')
  assert.strictEqual(iap._anon(), first, 'the same anonymous id comes back on every call')
  const fresh2 = freshRequire()
  assert.strictEqual(fresh2._anon(), first, 'and it survives a reload from localStorage')
  console.log('  anonymous id is stable across calls and reloads ✓')
}

async function testEventDelivery () {
  const win = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(win, 'despia', { set () {}, configurable: true })
  global.window = win
  global.self = win
  const iap = freshRequire()
  const got = { purchase: [], center: [], result: [] }
  iap.on('purchase', (d) => got.purchase.push(d))
  iap.on('center', (e) => got.center.push(e))
  iap.on('result', (r) => got.result.push(r))
  win.onRevenueCatPurchase({ info: 1 })
  win.onRevenueCatCenter({ event: 'restoreCompleted' })
  win.onRevenueCatResult({ ok: true, source: 'purchase' })
  assert.deepStrictEqual(got.purchase, [{ info: 1 }], "on('purchase') receives the native payload")
  assert.deepStrictEqual(got.center, [{ event: 'restoreCompleted' }], "on('center') receives Customer Center events")
  assert.strictEqual(got.result.length, 1, "on('result') receives outcomes")
  iap.off('purchase')
  win.onRevenueCatPurchase({ info: 2 })
  assert.strictEqual(got.purchase.length, 1, 'off(event) with no fn removes every listener for it')
  console.log("  events: purchase/center/result delivered, off(event) removes all ✓")
}

async function testV2DenialIsConfirmed () {
  // The seam: v2's rules for grace periods and other still-granting states
  // are undocumented, and it has been seen returning nothing for a customer
  // v1 reports as entitled. A denial from v2 must therefore be confirmed
  // against v1 before a paying customer loses access.
  const calls = []
  const iso = (ms) => new Date(ms).toISOString()
  global.fetch = async (url, init) => {
    calls.push({ url })
    if (url.includes('/v1/subscribers/grace_user')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ subscriber: { entitlements: { premium: { expires_date: iso(Date.now() - 86400000), grace_period_expires_date: iso(Date.now() + 86400000) } } } })
      }
    }
    if (url.includes('/v1/subscribers/')) {
      return { ok: true, status: 200, json: async () => ({ subscriber: { entitlements: {} } }) }
    }
    if (url.includes('/projects/p1/customers/rich/active_entitlements')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ entitlement_id: 'e1', expires_at: FUTURE_MS }] }) }
    }
    if (url.includes('/projects/p1/customers/') && url.includes('active_entitlements')) {
      return { ok: true, status: 200, json: async () => ({ items: [] }) }   // v2 says nothing
    }
    if (url.includes('/projects/p1/entitlements')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 'e1', lookup_key: 'premium' }] }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  delete require.cache[require.resolve('./server.cjs')]
  const server = require('./server.cjs')
  const v2 = { secret: 'sk_x', project: 'p1' }

  // A grace-period customer v2 omits is still entitled, because v1 is asked
  // before the denial stands. This is the whole point.
  assert.strictEqual(await server.entitled('grace_user', 'premium', v2), true, 'a v2 denial is confirmed against v1 before a paying customer loses access')

  // A genuinely non-subscribed user is still denied — the confirmation must
  // not turn into a free pass.
  assert.strictEqual(await server.entitled('freeloader', 'premium', v2), false, 'confirming a denial never grants access to a non-subscriber')

  // When v2 DOES report entitlements, it is taken at its word: no second
  // request, so the fast path stays fast.
  calls.length = 0
  assert.strictEqual(await server.entitled('rich', 'premium', v2), true)
  assert.ok(!calls.some((c) => c.url.includes('/v1/')), 'a positive v2 answer costs no extra request')

  // Opt-out for callers who would rather not spend the extra request.
  calls.length = 0
  assert.strictEqual(await server.entitled('grace_user', 'premium', { secret: 'sk_x', project: 'p1', confirmDenials: false }), false, 'confirmDenials:false takes v2 at its word')
  assert.ok(!calls.some((c) => c.url.includes('/v1/')), 'and spends no v1 request')
  console.log('  v2 denials are confirmed against v1, so the two paths never disagree against a customer ✓')
}

// §4: the opt-in answer cache. The asymmetry is the whole point, and it is
// exactly the kind of thing that rots silently if untested — caching denials
// would be invisible in every happy-path test and would lock out customers
// who just paid.
async function testServerAnswerCache () {
  const { entitled, entitlements } = require('./server.cjs')
  const FUTURE = new Date(Date.now() + 365 * 86400000).toISOString()
  let reads = 0
  const PEOPLE = {
    payer: { premium: { expires_date: FUTURE, product_identifier: 'p' } },
    freeloader: {}
  }
  global.fetch = async (url) => {
    const m = url.match(/\/v1\/subscribers\/([^/?]+)/)
    const who = m ? decodeURIComponent(m[1]) : null
    reads++
    return { ok: true, status: 200, json: async () => ({ subscriber: { entitlements: PEOPLE[who] || {} } }) }
  }
  const KEY = { key: 'appl_cachetest' }

  // Off by default: no cacheMs means every check is a real read.
  reads = 0
  await entitled('payer', 'premium', KEY)
  await entitled('payer', 'premium', KEY)
  assert.strictEqual(reads, 2, 'the cache is off unless asked for')

  // A grant is cached: the second check spends no request.
  reads = 0
  assert.strictEqual(await entitled('payer', 'premium', { ...KEY, cacheMs: 30000 }), true)
  assert.strictEqual(reads, 1, 'first check reads')
  assert.strictEqual(await entitled('payer', 'premium', { ...KEY, cacheMs: 30000 }), true)
  assert.strictEqual(reads, 1, 'second check is served from cache')

  // THE ASYMMETRY. A denial is never cached, so a customer who subscribes
  // between two checks is not held behind the TTL.
  reads = 0
  assert.strictEqual(await entitled('newbie', 'premium', { ...KEY, cacheMs: 30000 }), false)
  assert.strictEqual(reads, 1, 'a denial reads')
  PEOPLE.newbie = { premium: { expires_date: FUTURE, product_identifier: 'p' } }   // they just paid
  assert.strictEqual(
    await entitled('newbie', 'premium', { ...KEY, cacheMs: 30000 }), true,
    'a customer who just subscribed is granted immediately, never held behind a cached denial'
  )
  assert.strictEqual(reads, 2, 'because the denial was never stored')

  // The TTL actually expires rather than serving stale forever. Fresh id and
  // key so no entry from the blocks above is in play.
  PEOPLE.ttluser = { premium: { expires_date: FUTURE, product_identifier: 'p' } }
  reads = 0
  await entitlements('ttluser', { key: 'appl_ttl', cacheMs: 5 })
  assert.strictEqual(reads, 1, 'first read populates')
  await new Promise((r) => setTimeout(r, 25))
  await entitlements('ttluser', { key: 'appl_ttl', cacheMs: 5 })
  assert.strictEqual(reads, 2, 'an expired grant is re-read, not served stale')

  // Entries are per-credential: a different key must not read another
  // project's cached answer.
  reads = 0
  await entitled('payer', 'premium', { key: 'appl_one', cacheMs: 30000 })
  await entitled('payer', 'premium', { key: 'appl_two', cacheMs: 30000 })
  assert.strictEqual(reads, 2, 'a different key never reuses another project\'s answer')

  // Sandbox and production are separate answers for the same id.
  reads = 0
  await entitled('payer', 'premium', { key: 'appl_three', cacheMs: 30000 })
  await entitled('payer', 'premium', { key: 'appl_three', cacheMs: 30000, sandbox: true })
  assert.strictEqual(reads, 2, 'sandbox does not answer from the production cache')

  // The cache must hand back a COPY. A caller transforming the returned list
  // (sort, shift, filter in place) would otherwise rewrite the cache, and a
  // shrunk list denies a paying subscriber with no read to correct it.
  PEOPLE.mutator = { premium: { expires_date: FUTURE, product_identifier: 'p' }, pro: { expires_date: FUTURE, product_identifier: 'q' } }
  await entitlements('mutator', { key: 'appl_mut', cacheMs: 30000 })       // populates
  const served = await entitlements('mutator', { key: 'appl_mut', cacheMs: 30000 })  // FROM the cache
  served.length = 0                                  // an ordinary in-place transform
  assert.strictEqual(
    await entitled('mutator', 'premium', { key: 'appl_mut', cacheMs: 30000 }), true,
    'a caller mutating the returned list must not corrupt the cache into a denial'
  )

  // The TTL belongs to the writer, not whichever caller reads next. A 5s entry
  // must not be served for an hour just because the next caller asked for one.
  PEOPLE.shared = { premium: { expires_date: FUTURE, product_identifier: 'p' } }
  reads = 0
  await entitlements('shared', { key: 'appl_shared', cacheMs: 5 })     // short writer
  await new Promise((r) => setTimeout(r, 25))
  await entitlements('shared', { key: 'appl_shared', cacheMs: 3600000 })  // long reader
  assert.strictEqual(reads, 2, 'a short-lived entry is not resurrected by a long-TTL reader')

  // Concurrent checks on a cold cache must collapse into one request — the
  // stampede the cache exists to prevent.
  PEOPLE.burst = { premium: { expires_date: FUTURE, product_identifier: 'p' } }
  reads = 0
  const bursts = await Promise.all(
    Array.from({ length: 5 }, () => entitled('burst', 'premium', { key: 'appl_burst', cacheMs: 30000 }))
  )
  assert.deepStrictEqual(bursts, [true, true, true, true, true], 'every concurrent caller gets the right answer')
  assert.strictEqual(reads, 1, '5 concurrent cold-cache checks cost ONE RevenueCat request')

  console.log('  server cache: copies out, writer-owned TTL, in-flight joins, grants only ✓')
}

async function testServerHardening () {
  const calls = []
  const iso = (ms) => new Date(ms).toISOString()
  let listReads = 0
  global.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers })
    if (url.includes('/v1/subscribers/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          subscriber: {
            entitlements: {
              // Card is failing, store is retrying: RevenueCat reports the
              // grace window separately and the device still says entitled.
              grace: { expires_date: iso(Date.now() - 86400000), grace_period_expires_date: iso(Date.now() + 86400000) },
              lapsed: { expires_date: iso(Date.now() - 86400000), grace_period_expires_date: iso(Date.now() - 3600000) },
              lifetime: { expires_date: null },
              broken: null
            }
          }
        })
      }
    }
    if (url.includes('/projects/projHerd/entitlements?')) {
      listReads++
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 'entlH', lookup_key: 'premium' }] }) }
    }
    if (url.includes('/projects/projHerd/customers/') && url.includes('active_entitlements')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ entitlement_id: 'entlH', expires_at: FUTURE_MS }] }) }
    }
    if (url.includes('/projects/projEvil/entitlements?')) {
      // A tampered/buggy page pointer must never redirect the API key.
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 'entlE', lookup_key: 'premium' }], next_page: 'http://attacker.example/steal' }) }
    }
    if (url.includes('/projects/projEvil/customers/') && url.includes('active_entitlements')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ entitlement_id: 'entlE', expires_at: FUTURE_MS }] }) }
    }
    if (url.includes('/projects/projSec/entitlements?')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 'entlS', lookup_key: 'premium' }] }) }
    }
    if (url.includes('/projects/projSec/customers/') && url.includes('active_entitlements')) {
      // Epoch SECONDS instead of ms must not render as 1970.
      return { ok: true, status: 200, json: async () => ({ items: [{ entitlement_id: 'entlS', expires_at: Math.floor(FUTURE_MS / 1000) }] }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  delete require.cache[require.resolve('./server.cjs')]
  const server = require('./server.cjs')

  // A billing grace period keeps a paying customer entitled: their device
  // says yes, and the server must not disagree.
  assert.strictEqual(await server.entitled('u1', 'grace', { key: 'appl_pub' }), true, 'grace period stays entitled')
  assert.strictEqual(await server.entitled('u1', 'lapsed', { key: 'appl_pub' }), false, 'expired grace is not entitled')
  assert.strictEqual(await server.entitled('u1', 'lifetime', { key: 'appl_pub' }), true, 'null expiry is lifetime')
  assert.strictEqual(await server.entitled('u1', 'broken', { key: 'appl_pub' }), false, 'a null entitlement object never grants access')

  // 'false' is a string, and truthiness would have turned sandbox ON in
  // production, hiding every real purchase.
  calls.length = 0
  await server.entitled('u1', 'grace', { key: 'appl_pub', sandbox: 'false' })
  assert.ok(!calls[0].headers['X-Is-Sandbox'], "sandbox:'false' is OFF, not truthy-ON")
  calls.length = 0
  await server.entitled('u1', 'grace', { key: 'appl_pub', sandbox: 'yes' })
  assert.strictEqual(calls[0].headers['X-Is-Sandbox'], 'true', "sandbox:'yes' is ON")

  // A numeric string from config must not crash AbortSignal.timeout.
  assert.strictEqual(await server.entitled('u1', 'grace', { key: 'appl_pub', timeout: '5000' }), true, 'numeric-string timeout works')

  // A page pointer to another host must NOT receive the API key.
  calls.length = 0
  await server.entitled('u1', 'premium', { secret: 'sk_x', project: 'projEvil' })
  assert.ok(!calls.some((c) => c.url.includes('attacker')), 'never follows next_page off the RevenueCat origin')

  // Concurrent cold-cache checks make ONE list request, not N.
  calls.length = 0
  listReads = 0
  const herd = await Promise.all(Array.from({ length: 20 }, () => server.entitled('u1', 'premium', { secret: 'sk_x', project: 'projHerd' })))
  assert.ok(herd.every(Boolean), 'all concurrent checks resolve entitled')
  assert.strictEqual(listReads, 1, 'in-flight dedup: 20 concurrent checks share one lookup fetch')

  // Sandbox verification must ride v1 even with a secret key + project
  // configured: X-Is-Sandbox is a v1 header and v2 has no documented sandbox
  // support, so routing a tester through v2 would deny every sandbox purchase
  // with no way for them to fix it.
  calls.length = 0
  await server.entitled('u1', 'grace', { secret: 'sk_x', project: 'projHerd', sandbox: true })
  assert.ok(calls.every((c) => c.url.includes('/v1/')), 'a sandbox check never uses v2')
  assert.strictEqual(calls[0].headers['X-Is-Sandbox'], 'true', 'and it carries the v1 sandbox header')
  // ...while the same credentials without sandbox still prefer v2.
  calls.length = 0
  await server.entitled('u1', 'premium', { secret: 'sk_x', project: 'projHerd' })
  assert.ok(calls.some((c) => c.url.includes('/v2/')), 'production checks still use v2 when configured')
  assert.ok(calls.every((c) => !c.headers['X-Is-Sandbox']), 'the v1-only sandbox header is never sent to v2')

  // Epoch seconds must not become 1970.
  const secs = await server.entitlements('u1', { secret: 'sk_x', project: 'projSec' })
  assert.ok(new Date(secs[0].expires).getUTCFullYear() > 2020, 'epoch-seconds expires_at is not read as 1970')

  console.log('  server hardening: grace period, sandbox strings, SSRF, herd, epoch units ✓')
}

async function testV4 () {
  const calls = []
  const mod = {
    available: true,
    catalog: (args) => { calls.push(['catalog', args]); return Promise.resolve(envelope(4)) },
    customer: (args) => {
      calls.push(['customer', args])
      return Promise.resolve(Object.assign(envelope(4), {
        entitlements: { active: ['premium'], all: ['premium', 'old'] },
        subscriptions: ['premium:monthly'], management: 'https://play.google.com/store/account/subscriptions'
      }))
    },
    history: (args) => Promise.resolve([{ productId: 'p1', entitlementId: 'premium', isActive: true }]),
    purchase: (args) => {
      calls.push(['purchase', args])
      return Promise.resolve({
        status: 'purchased', product_id: 'premium:monthly', plan_id: 'monthly',
        active_entitlements: ['premium'], transaction: { id: 'txn9' }, customer_info: {}
      })
    },
    paywall: (args) => {
      calls.push(['paywall', args])
      setTimeout(() => {
        win.revenueCatResult = {
          ok: true, cancelled: false, restored: false, source: 'paywall', product: 'premium:monthly',
          transaction: 't1', entitlements: ['premium'], user: 'u1', platform: 'android', runtime: 4, error: null, code: null
        }
        if (typeof win.onRevenueCatResult === 'function') win.onRevenueCatResult(win.revenueCatResult)
      }, 30)
      return Promise.resolve({ status: 'presented', offering: 'default' })
    },
    center: () => Promise.resolve({ status: 'presented' })
  }
  const win = {
    navigator: { userAgent: 'despia-android' },
    native_os: 'android',
    __dsxWire: { bound: true },
    dsx: { module: { revenuecat: mod } },
    localStorage: null
  }
  global.window = win
  global.self = win
  const iap = freshRequire()
  assert.strictEqual(iap.runtime, 4)
  assert.strictEqual(iap.os, 'android')
  await iap.login('u1')

  const products = await iap.products()
  assert.strictEqual(products[0].id, 'premium:monthly')
  assert.strictEqual(calls[0][0], 'catalog')
  assert.strictEqual(calls[0][1].external_id, 'u1')

  const buy = await iap.buy('premium:monthly')
  assert.strictEqual(buy.ok, true)
  assert.strictEqual(buy.transaction, 'txn9')

  const paywall = await iap.paywall('default')
  assert.strictEqual(paywall.ok, true)
  assert.strictEqual(paywall.source, 'paywall')

  assert.strictEqual(await iap.has('premium'), true)
  const status = await iap.status()
  assert.strictEqual(status.management, 'https://play.google.com/store/account/subscriptions')
  console.log('  v4: catalog/purchase/paywall/customer over the dsx module bus ✓')
}

async function testV4OldBuild () {
  // A V4 build whose module predates catalog/customer: those calls reject,
  // the package falls back to products() + history().
  const win = {
    navigator: { userAgent: 'despia-iphone' },
    native_os: 'ios',
    __dsxWire: { bound: true },
    localStorage: null,
    dsx: {
      module: {
        revenuecat: {
          catalog: () => Promise.reject({ event: 'error', code: 'timeout' }),
          customer: () => Promise.reject({ event: 'error', code: 'timeout' }),
          products: () => Promise.resolve([{
            id: 'coins_100', type: 'non_consumable', title: 'Coins', description: '100 coins',
            price: { amount: 4.99, amount_micros: 4990000, currency: 'EUR', formatted: '€4.99' }, store: 'app_store'
          }]),
          history: () => Promise.resolve([{ productId: 'coins_100', entitlementId: null, isActive: true }])
        }
      }
    }
  }
  global.window = win
  global.self = win
  const iap = freshRequire()
  const products = await iap.products()
  assert.strictEqual(products.length, 1)
  assert.strictEqual(products[0].priceString, '€4.99')
  assert.strictEqual(products[0].type, 'product')
  const status = await iap.status()
  assert.strictEqual(status.ok, true)
  console.log('  v4 old build: catalog falls back to the products action ✓')
}

async function testV4Identity () {
  // Identity on a current V4 build: user() asks the native whoami action,
  // anonymous purchases carry no external_id, and an identity the SDK
  // persisted across restarts is adopted.
  const calls = []
  let logged = null
  const mod = {
    whoami: (args) => {
      calls.push(['whoami', args])
      return Promise.resolve(logged
        ? { app_user_id: logged, is_anonymous: false }
        : { app_user_id: '$RCAnonymousID:xyz', is_anonymous: true })
    },
    login: (args) => {
      calls.push(['login', args])
      logged = args.external_id
      return Promise.resolve({ ok: true, user: logged, anonymous: false, new: true })
    },
    purchase: (args) => {
      calls.push(['purchase', args])
      return Promise.resolve({
        status: 'purchased', product_id: 'coins_100', plan_id: '',
        active_entitlements: [], transaction: { id: 't2' }, customer_info: {}
      })
    }
  }
  const win = {
    navigator: { userAgent: 'despia-iphone' },
    native_os: 'ios',
    __dsxWire: { bound: true },
    dsx: { module: { revenuecat: mod } },
    localStorage: { _s: {}, getItem (k) { return this._s[k] || null }, setItem (k, v) { this._s[k] = v } }
  }
  global.window = win
  global.self = win
  const iap = freshRequire()

  // Nobody logged in: the raw anonymous id surfaces, registered says no.
  const anon = await iap.user()
  assert.strictEqual(anon.id, '$RCAnonymousID:xyz')
  assert.strictEqual(anon.user, null)
  assert.strictEqual(anon.registered, false)
  assert.strictEqual(iap.id, null)

  // Anonymous purchase: no external_id in the native args.
  const buy = await iap.buy('coins_100.pack')
  assert.strictEqual(buy.ok, true)
  const anonBuy = calls.find((c) => c[0] === 'purchase')
  assert.ok(anonBuy && !('external_id' in anonBuy[1]), 'anonymous V4 purchase omits external_id')
  assert.ok(!('b44rc_anon' in win.localStorage._s), 'no synthesized id on a current V4 build')

  // Login, then the identity read reports the registered user.
  await iap.user('u7')
  await new Promise((r) => setTimeout(r, 50))   // fire-and-forget login probe
  const me = await iap.user()
  assert.strictEqual(me.user, 'u7')
  assert.strictEqual(me.registered, true)

  // A login the native SDK persisted across restarts is adopted locally.
  const iap2 = freshRequire()
  assert.strictEqual(iap2.id, null)
  const persisted = await iap2.user()
  assert.strictEqual(persisted.user, 'u7')
  assert.strictEqual(persisted.registered, true)
  assert.strictEqual(iap2.id, 'u7', 'persisted native login adopted')
  console.log('  v4 identity: whoami read + anonymous purchase + adoption ✓')
}

async function testV4LegacyRetry () {
  // An old V4 build that still hard-requires external_id: the first
  // anonymous attempt rejects missing_param, the package retries once the
  // legacy way with a synthesized id, and the call still succeeds.
  const purchaseArgs = []
  const paywallArgs = []
  const win = {
    navigator: { userAgent: 'despia-android' },
    native_os: 'android',
    __dsxWire: { bound: true },
    localStorage: { _s: {}, getItem (k) { return this._s[k] || null }, setItem (k, v) { this._s[k] = v } },
    dsx: {
      module: {
        revenuecat: {
          purchase: (args) => {
            purchaseArgs.push(args)
            if (!args.external_id) return Promise.reject({ code: 'missing_param', message: 'Missing required parameter: external_id.' })
            return Promise.resolve({
              status: 'purchased', product_id: 'coins_100', plan_id: '',
              active_entitlements: [], transaction: { id: 't3' }, customer_info: {}
            })
          },
          paywall: (args) => {
            paywallArgs.push(args)
            if (!args.external_id) return Promise.reject({ code: 'missing_param', message: 'Missing required parameter: external_id.' })
            setTimeout(() => {
              win.revenueCatResult = {
                ok: true, cancelled: false, restored: false, source: 'paywall', product: 'premium:monthly',
                transaction: 't4', entitlements: ['premium'], user: args.external_id,
                platform: 'android', runtime: 4, error: null, code: null
              }
              if (typeof win.onRevenueCatResult === 'function') win.onRevenueCatResult(win.revenueCatResult)
            }, 30)
            return Promise.resolve({ status: 'presented', offering: 'default' })
          }
        }
      }
    }
  }
  global.window = win
  global.self = win
  const iap = freshRequire()

  const buy = await iap.buy('coins_100.pack')
  assert.strictEqual(buy.ok, true, 'purchase succeeds after the legacy retry')
  assert.strictEqual(purchaseArgs.length, 2)
  assert.ok(!purchaseArgs[0].external_id, 'first attempt is anonymous')
  assert.ok(/^b44_/.test(purchaseArgs[1].external_id), 'retry carries the synthesized id')

  const paywall = await iap.paywall()
  assert.strictEqual(paywall.ok, true, 'paywall succeeds after the legacy retry')
  assert.strictEqual(paywallArgs.length, 2)
  assert.ok(/^b44_/.test(paywallArgs[1].external_id), 'paywall retry carries the synthesized id')
  console.log('  v4 legacy build: missing_param triggers one synthesized-id retry ✓')
}

async function testEmptyCustomerEnvelope () {
  // A build whose `customer` action acks with an empty object must NOT mask
  // the store history: a live subscriber would read as not entitled. Same
  // guard the `entitlements` action already has (see 1.4.2).
  const win = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  win.dsx = {
    module: {
      revenuecat: {
        customer: () => Promise.resolve({}),   // bare ack, no entitlement data
        history: () => Promise.resolve([{ productId: 'p1', entitlementId: 'premium', isActive: true, type: 'subscription' }]),
        entitlements: () => Promise.resolve({ active: [], all: [] })
      }
    }
  }
  global.window = win
  global.self = win
  const iap = freshRequire()
  const status = await iap.status()
  assert.deepStrictEqual(status.active, ['premium'], 'empty customer envelope falls through to history')
  assert.strictEqual(await iap.has('premium'), true)

  // The V3 shape of the same bug: envelope answers {}, history shows active.
  const fired = []
  const win3 = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(win3, 'despia', {
    set (cmd) {
      fired.push(cmd)
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://customer')) {
          win3.revenueCatCustomer = { ok: true, runtime: 3 }   // no entitlements key
          if (typeof win3.onRevenueCatCustomer === 'function') win3.onRevenueCatCustomer(win3.revenueCatCustomer)
        } else if (cmd.startsWith('getpurchasehistory://')) {
          win3.restoredData = [{ productId: 'p1', entitlementId: 'premium', isActive: true, type: 'subscription' }]
        }
      }, 10)
    },
    configurable: true
  })
  global.window = win3
  global.self = win3
  const iap3 = freshRequire()
  const s3 = await iap3.status()
  assert.deepStrictEqual(s3.active, ['premium'], 'V3: bare customer ack falls through to history')

  // A REAL empty answer (entitlements reported, none active, no history) is
  // still an answer: nothing regresses to a timeout.
  const winEmpty = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  winEmpty.dsx = {
    module: {
      revenuecat: {
        customer: () => Promise.resolve({ ok: true, runtime: 4, entitlements: { active: [], all: ['old'] }, subscriptions: [] }),
        history: () => Promise.resolve([])
      }
    }
  }
  global.window = winEmpty
  global.self = winEmpty
  const iapEmpty = freshRequire()
  const sEmpty = await iapEmpty.status()
  assert.strictEqual(sEmpty.ok, true)
  assert.deepStrictEqual(sEmpty.active, [])
  assert.deepStrictEqual(sEmpty.all, ['old'], 'a reporting envelope still wins over empty history')

  // A real envelope with empty entitlements (products not attached / a
  // consumables-only app) but live subscriptions metadata: history answers
  // the entitlement question, the envelope's metadata must survive.
  const winMeta = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  winMeta.dsx = {
    module: {
      revenuecat: {
        customer: () => Promise.resolve({
          ok: true,
          runtime: 4,
          entitlements: { active: [], all: [] },
          subscriptions: ['premium:monthly'],
          management: 'https://play.google.com/store/account/subscriptions'
        }),
        history: () => Promise.resolve([{ productId: 'p1', entitlementId: 'premium', isActive: true, type: 'subscription' }])
      }
    }
  }
  global.window = winMeta
  global.self = winMeta
  const iapMeta = freshRequire()
  const sMeta = await iapMeta.status()
  assert.deepStrictEqual(sMeta.active, ['premium'], 'history answers entitlements')
  assert.deepStrictEqual(sMeta.subscriptions, ['premium:monthly'], 'envelope subscriptions metadata survives the fallback')
  assert.strictEqual(sMeta.management, 'https://play.google.com/store/account/subscriptions', 'manage link survives the fallback')
  console.log('  empty customer envelope: store history still answers, subscriber keeps access ✓')
}

async function testSyncNativeAnswerNotLost () {
  // Regression: the response channel must be registered BEFORE the scheme
  // fires. A native layer that answers synchronously (same tick as the
  // window.despia assignment) used to have its answer deleted by the
  // listener setup, and the call sat on the full timeout.
  const win = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(win, 'despia', {
    set (cmd) {
      if (cmd.startsWith('revenuecat://customer')) {
        win.revenueCatCustomer = Object.assign(envelope(3), {
          entitlements: { active: ['premium'], all: ['premium'] }, subscriptions: []
        })
      } else if (cmd.startsWith('getpurchasehistory://')) {
        win.restoredData = []
      }
    },
    configurable: true
  })
  global.window = win
  global.self = win
  const iap = freshRequire()
  const t0 = Date.now()
  const status = await iap.status()
  assert.deepStrictEqual(status.active, ['premium'])
  // The value assertion above is the real proof (a lost answer resolves
  // undefined); this only guards against it being recovered by timeout.
  assert.ok(Date.now() - t0 < iap._t.read, 'synchronous native answer resolved before the timeout')
  console.log('  sync native answer: registered listener wins the race ✓')
}

async function testCatalogInvalidatedOnUserSwitch () {
  // Targeted offerings can price users differently: switching identity must
  // drop the cached catalog exactly like logout() always did.
  const win = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  let served = 0
  win.dsx = {
    module: {
      revenuecat: {
        catalog: () => { served++; return Promise.resolve(envelope(4)) },
        login: () => Promise.resolve({}),
        whoami: () => Promise.resolve({ app_user_id: 'adopted', is_anonymous: false })
      }
    }
  }
  global.window = win
  global.self = win
  const iap = freshRequire()

  // Adoption is an identity change too: a catalog cached while anonymous
  // must not survive user() (no args) picking up a persisted native login.
  await iap.plans()
  assert.ok(iap._catalog, 'catalog cached while anonymous')
  const adopted = await iap.user()
  assert.strictEqual(adopted.user, 'adopted')
  assert.strictEqual(iap._catalog, null, 'identity adoption drops the cached catalog')

  await iap.user('alice')
  await iap.plans()
  assert.ok(iap._catalog, 'catalog cached for alice')
  await iap.user('bob')
  assert.strictEqual(iap._catalog, null, 'switching users drops the cached catalog')
  await iap.user('bob')
  await iap.plans()
  const cached = iap._catalog
  await iap.user('bob')                       // same id: cache survives
  assert.strictEqual(iap._catalog, cached, 'rebinding the same id keeps the cache')
  assert.strictEqual(served, 3)
  console.log('  user switch: cached catalog invalidated on switch AND adoption ✓')
}

async function testOnUnsubscribeReleasesBookkeeping () {
  // The unsubscribe closure returned by on() must release the package's own
  // subscription entry, not only the hub listener, or subscribe/unsubscribe
  // cycles (one per component mount) grow memory forever.
  const win = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(win, 'despia', { set () {}, configurable: true })
  global.window = win
  global.self = win
  const iap = freshRequire()
  for (let i = 0; i < 5; i++) {
    const stop = iap.on('result', function () {})
    stop()
    stop()                                     // double-call stays safe
  }
  assert.strictEqual((iap._subs.result || []).length, 0, 'returned unsubscribe releases the entry')
  const fn = function () {}
  iap.on('result', fn)
  iap.off('result', fn)
  assert.strictEqual(iap._subs.result.length, 0, 'off(event, fn) still works')
  console.log('  on()/off(): unsubscribe releases all bookkeeping ✓')
}

async function testCenterHonesty () {
  // A build without Customer Center must say so immediately, and a silent
  // native layer must resolve ok:false — never a 30-minute wait that then
  // reports success.
  const winNoModule = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  winNoModule.dsx = { module: {} }             // bus bound, module excluded
  global.window = winNoModule
  global.self = winNoModule
  let iap = freshRequire()
  const unsupported = await iap.center()
  assert.strictEqual(unsupported.ok, false)
  assert.strictEqual(unsupported.code, 'unsupported')

  // An UNPROVEN classic build never fires the center scheme (old catch-alls
  // raise a native alert on unknown revenuecat:// actions). It may probe with
  // the catalog read, which every classic build carries, but silence there
  // means an old build: unsupported, and no center scheme fired.
  const fired = []
  const winUnproven = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(winUnproven, 'despia', { set (cmd) { fired.push(cmd) }, configurable: true })
  global.window = winUnproven
  global.self = winUnproven
  iap = freshRequire()
  const gated = await iap.center()
  assert.strictEqual(gated.code, 'unsupported')
  assert.ok(!fired.some((c) => c.startsWith('revenuecat://center')), 'no center scheme fired without bridge proof')

  // A CAPABLE classic build whose app opens the account screen first: the
  // probe proves the bridge, so Customer Center still works (it must not be
  // reported unsupported just because nothing else ran yet).
  const winProbe = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(winProbe, 'despia', {
    set (cmd) {
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://products')) {
          winProbe.revenueCatProducts = envelope(3)          // proves the bridge
          if (typeof winProbe.onRevenueCatProducts === 'function') winProbe.onRevenueCatProducts(winProbe.revenueCatProducts)
        } else if (cmd.startsWith('revenuecat://center')) {
          if (typeof winProbe.onRevenueCatCenter === 'function') winProbe.onRevenueCatCenter({ event: 'dismissed' })
        }
      }, 10)
    },
    configurable: true
  })
  global.window = winProbe
  global.self = winProbe
  iap = freshRequire()
  const probed = await iap.center()                          // first call of all
  assert.strictEqual(probed.ok, true, 'capable build still opens Customer Center on a cold first call')

  // Silence on a PROVEN V3 build: resolves ok:false, code timeout.
  const winSilent = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(winSilent, 'despia', {
    set (cmd) {
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://products')) {
          winSilent.revenueCatProducts = envelope(3)   // proves the bridge
          if (typeof winSilent.onRevenueCatProducts === 'function') winSilent.onRevenueCatProducts(winSilent.revenueCatProducts)
        } // center: silence
      }, 10)
    },
    configurable: true
  })
  global.window = winSilent
  global.self = winSilent
  iap = freshRequire()
  await iap.products()
  const timedOut = await iap.center()
  assert.strictEqual(timedOut.ok, false)
  assert.strictEqual(timedOut.code, 'timeout')

  // An AMBIGUOUS V4 probe failure (ack timeout on a build that answers only
  // at dismissal) must NOT settle early: the later dismissal still wins.
  const winSlow = { navigator: { userAgent: 'x' }, localStorage: null, __dsxWire: true }
  winSlow.dsx = {
    module: {
      revenuecat: {
        center: () => new Promise((resolve, reject) => {
          reject({ code: 'timeout' })                    // ack timed out...
          setTimeout(() => {
            if (typeof winSlow.onRevenueCatCenter === 'function') winSlow.onRevenueCatCenter({ event: 'dismissed' })
          }, 60)                                         // ...but the sheet was up and closes later
        })
      }
    }
  }
  global.window = winSlow
  global.self = winSlow
  iap = freshRequire()
  const lateClose = await iap.center()
  assert.strictEqual(lateClose.ok, true, 'ambiguous ack failure keeps waiting for the real dismissal')

  // The good path: a dismissed event resolves ok:true.
  const winOk = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(winOk, 'despia', {
    set (cmd) {
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://products')) {
          winOk.revenueCatProducts = envelope(3)
          if (typeof winOk.onRevenueCatProducts === 'function') winOk.onRevenueCatProducts(winOk.revenueCatProducts)
        } else if (cmd.startsWith('revenuecat://center')) {
          if (typeof winOk.onRevenueCatCenter === 'function') winOk.onRevenueCatCenter({ event: 'dismissed' })
        }
      }, 10)
    },
    configurable: true
  })
  global.window = winOk
  global.self = winOk
  iap = freshRequire()
  await iap.products()
  const closed = await iap.center()
  assert.strictEqual(closed.ok, true)
  assert.strictEqual(closed.code, null)
  console.log('  center: gated on V3 proof, honest codes, late dismissal never lost ✓')
}

async function testBuyRejectsUnusableInput () {
  const win = { navigator: { userAgent: 'despia-iphone' }, localStorage: null }
  Object.defineProperty(win, 'despia', { set () {}, configurable: true })
  global.window = win
  global.self = win
  const iap = freshRequire()
  for (const bad of [{}, { product: null }, { product: {} }, '']) {
    const r = await iap.buy(bad)
    assert.strictEqual(r.ok, false)
    assert.strictEqual(r.code, 'missing_param', 'unusable buy() input fails fast: ' + JSON.stringify(bad))
  }
  console.log('  buy: unusable input fails fast with missing_param ✓')
}

;(async () => {
  console.log('base44-revenuecat smoke tests')
  await testWeb()
  await testV3()
  await testV3OldBuild()
  await testV3Bridge2()
  await testV3LegacyAnon()
  await testV4()
  await testV4OldBuild()
  await testV4Identity()
  await testV4LegacyRetry()
  await testV4LegacyActions()
  await testV3LegacyOfferings()
  await testOfferingFilterNeverWidens()
  await testEmptyEntitlementsFallsThrough()
  await testModuleExcludedFailsFast()
  await testLegacyIntroOfferFidelity()
  await testBusArrivesLate()
  await testEntitlementLifecycleState()
  await testRuntimeDetection()
  await testDestructured()
  await testRedeemStub()
  await testEmptyCustomerEnvelope()
  await testSyncNativeAnswerNotLost()
  await testCatalogInvalidatedOnUserSwitch()
  await testOnUnsubscribeReleasesBookkeeping()
  await testCenterHonesty()
  await testBuyRejectsUnusableInput()
  await testMultiOfferingPricing()
  await testTerminalErrorsSettleFast()
  await testLapsedAndPlanResolution()
  await testSharedResultChannelIsolation()
  await testAnonIdStability()
  await testEventDelivery()
  await testCatalogShapeInvariants()
  await testStatusSourceInvariants()
  await testWhoami()
  await testResolutionMatrix()
  await testEmptyVersusNegativeClassification()
  await testMoneyPathInvariants()
  await testNonDecidingSourceKeepsMetadata()
  await testServer()
  await testServerIdentityAndMatching()
  await testServerCacheAndEncoding()
  await testV2DenialIsConfirmed()
  await testServerAnswerCache()
  await testServerHardening()
  console.log('all tests passed')
  // Give any late rejection a turn to surface before exiting green.
  setTimeout(() => process.exit(0), 50)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
