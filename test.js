// Smoke tests for base44-revenuecat: simulates the three runtimes the package
// targets — plain browser, Despia V3 (scheme bridge + window callbacks), and
// Despia V4 (window.dsx module promises) — and asserts the unified shapes.
// Run: node test.js

'use strict'

const assert = require('assert')

const PRODUCT = {
  id: 'premium:monthly', sku: 'premium', plan: 'monthly', type: 'subscription',
  title: 'Premium Monthly', desc: 'Everything', price: 9.99, priceString: '$9.99',
  currency: 'USD', period: 'P1M', periodUnit: 'month', periodCount: 1,
  intro: null, offering: 'default', package: '$rc_monthly', packageType: 'monthly'
}

function envelope (runtime) {
  return {
    ok: true, provider: 'revenuecat', platform: 'ios', runtime, project: 'proj123',
    user: 'u1', anonymous: false, current: 'default',
    offerings: [{ id: 'default', current: true, packages: [{ id: '$rc_monthly', type: 'monthly', product: PRODUCT }] }],
    products: [PRODUCT], error: null, code: null
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
  const win = {
    navigator: { userAgent: 'Mozilla/5.0 (iPhone) despia-iphone' },
    localStorage: { _s: {}, getItem (k) { return this._s[k] || null }, setItem (k, v) { this._s[k] = v } }
  }
  // The native runtime intercepts assignments to window.despia.
  Object.defineProperty(win, 'despia', {
    set (cmd) {
      setTimeout(() => {
        if (cmd.startsWith('revenuecat://products')) {
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
  await iap.login('u1')

  const products = await iap.products()
  assert.strictEqual(products.length, 1)
  assert.strictEqual(products[0].priceString, '$9.99')
  assert.strictEqual(iap.project, 'proj123', 'project id auto-filled from envelope')

  const buy = await iap.buy(products[0].id)
  assert.strictEqual(buy.ok, true)
  assert.deepStrictEqual(buy.entitlements, ['premium'])

  const paywall = await iap.paywall()
  assert.strictEqual(paywall.cancelled, true)

  const t0 = Date.now()
  const restore = await iap.restore()
  assert.ok(Date.now() - t0 < 5000, 'empty history resolves promptly, not on timeout')
  assert.deepStrictEqual(restore.purchases, [])

  const status = await iap.status()
  assert.deepStrictEqual(status.active, ['premium'])
  assert.strictEqual(await iap.has('premium'), true)
  assert.strictEqual(await iap.has('nope'), false)
  console.log('  v3: products/buy/paywall/restore/status/has over the scheme bridge ✓')
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
  console.log('  v3 old build: entitlements fall back to store history ✓')
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

;(async () => {
  console.log('base44-revenuecat smoke tests')
  await testWeb()
  await testV3()
  await testV3OldBuild()
  await testV4()
  await testV4OldBuild()
  console.log('all tests passed')
  process.exit(0)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
