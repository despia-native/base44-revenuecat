// Smoke tests for base44-revenuecat: simulates the three runtimes the package
// targets, plain browser, Despia V3 (scheme bridge + window callbacks), and
// Despia V4 (window.dsx module promises), and asserts the unified shapes.
// Run: node test.js

'use strict'

const assert = require('assert')

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
  return require('./index.js')
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
  assert.ok(elapsed < 1000, 'a bound bus without the module answers immediately, took ' + elapsed + 'ms')
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
  assert.ok(Date.now() - t1 < 500, 'a plain browser resolves immediately, no bus wait')
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

async function testServer () {
  const calls = []
  global.fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization })
    if (url.includes('/v1/subscribers/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          subscriber: {
            entitlements: {
              premium: { expires_date: null, product_identifier: 'premium:monthly' },
              old: { expires_date: '2020-01-01T00:00:00Z' }
            }
          }
        })
      }
    }
    if (url.includes('/customers/') && url.includes('active_entitlements')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ entitlement_id: 'entl123', expires_at: null }] }) }
    }
    if (url.includes('/entitlements?')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 'entl123', lookup_key: 'premium' }] }) }
    }
    return { ok: false, status: 404, json: async () => ({}) }
  }
  delete require.cache[require.resolve('./server.cjs')]
  const server = require('./server.cjs')

  // Zero-secret: public SDK key rides the v1 subscribers endpoint.
  assert.strictEqual(await server.entitled('u1', 'premium', { key: 'appl_pub' }), true)
  assert.strictEqual(await server.entitled('u1', 'old', { key: 'appl_pub' }), false, 'expired entitlement is inactive')
  assert.ok(calls[0].url.includes('/v1/subscribers/u1'))
  assert.strictEqual(calls[0].auth, 'Bearer appl_pub')

  // Secret + project: v2 path with the entl->lookup_key join.
  calls.length = 0
  const ents = await server.entitlements('u1', { secret: 'sk_test', project: 'proj123' })
  assert.deepStrictEqual(ents, [{ id: 'premium', expires: null }])
  assert.ok(calls[0].url.includes('/v2/projects/proj123/customers/u1/active_entitlements'))

  // Public key + project must NOT attempt v2 (public keys are v1-only).
  calls.length = 0
  await server.entitled('u1', 'premium', { key: 'appl_pub', project: 'proj123' })
  assert.ok(calls.every((c) => c.url.includes('/v1/')), 'public key stays on v1')

  console.log('  server: public-key v1 path + secret v2 lookup-key join ✓')
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
  await testServer()
  console.log('all tests passed')
  process.exit(0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
