// base44-revenuecat — RevenueCat in-app purchases & subscriptions for Base44
// apps shipped as native iOS / Android apps with Despia (https://despia.com).
//
// One tiny promise-based API over the App Store (StoreKit) and Google Play
// (Play Billing) purchase stack that Despia compiles into your binary:
//
//   import revenuecat from 'base44-revenuecat'
//   await revenuecat.user(user.id)                    // your Base44 user id
//   const plans = await revenuecat.plans()            // live store prices
//   await revenuecat.buy('monthly')                   // native purchase sheet
//   await revenuecat.paywall()                        // RevenueCat native paywall
//   if (await revenuecat.has('premium')) unlock()     // entitlement gate
//
// Works on BOTH Despia runtimes with zero configuration:
//   - Despia V3 (the classic runtime): URL-scheme bridge + window callbacks
//   - Despia V4 (Despia Framework):    window.dsx module promises
// and safely no-ops in a plain browser (Base44 preview) — every call resolves,
// nothing throws, so your app keeps working while you build.
//
// Server-side entitlement verification for Base44 backend functions lives in
// the companion entry:  import { entitled } from 'npm:base44-revenuecat/server'

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory)
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory()
  } else {
    root.b44rc = factory()
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict'

  var W = typeof window !== 'undefined' ? window : null

  // ── environment ──────────────────────────────────────────────────────────

  // 4 = Despia Framework (window.dsx module bus), 3 = classic Despia runtime
  // (URL-scheme bridge), 0 = plain browser (Base44 preview / desktop web).
  function runtime () {
    if (!W) return 0
    try {
      if (W.__dsxWire && W.dsx && W.dsx.module) return 4
      var ua = (W.navigator && W.navigator.userAgent || '').toLowerCase()
      if (ua.indexOf('despia') !== -1) return W.__dsxWire ? 4 : 3
    } catch (e) {}
    return 0
  }

  function os () {
    if (!W) return 'web'
    try {
      if (W.native_os === 'ios' || W.native_os === 'android') return W.native_os
      var ua = (W.navigator && W.navigator.userAgent || '').toLowerCase()
      if (ua.indexOf('despia') === -1) return 'web'
      if (ua.indexOf('android') !== -1) return 'android'
      if (ua.indexOf('iphone') !== -1 || ua.indexOf('ipad') !== -1 || ua.indexOf('ios') !== -1) return 'ios'
    } catch (e) {}
    return 'web'
  }

  function warn (msg) {
    try { if (iap.debug && typeof console !== 'undefined') console.warn('[base44-revenuecat] ' + msg) } catch (e) {}
  }

  // ── window-callback hub ──────────────────────────────────────────────────
  // One chained hook per native callback. An app-defined handler installed
  // before us keeps firing; listeners added here fan out after it.

  var hubs = {}

  function hub (cbName) {
    if (!W) return { add: function () { return function () {} } }
    var h = hubs[cbName]
    if (h) return h
    var listeners = []
    var prev = W[cbName]
    W[cbName] = function (data) {
      try { if (typeof prev === 'function') prev(data) } catch (e) {}
      for (var i = listeners.slice(), j = 0; j < i.length; j++) {
        try { i[j](data) } catch (e) {}
      }
    }
    h = hubs[cbName] = {
      add: function (fn) {
        listeners.push(fn)
        return function remove () {
          var at = listeners.indexOf(fn)
          if (at !== -1) listeners.splice(at, 1)
        }
      }
    }
    return h
  }

  // ── V3 transport: fire a scheme, await a window variable/callback ────────

  var queue = []
  var draining = false

  function fire (command) {
    if (!W) return
    queue.push(command)
    drain()
  }

  function drain () {
    if (draining || !queue.length) return
    draining = true
    try { W.despia = queue.shift() } catch (e) {}
    // Successive scheme navigations can swallow each other on iOS — space them.
    setTimeout(function () { draining = false; drain() }, 80)
  }

  // Await `window[varName]` (poll) and/or `window[cbName]` (push), whichever
  // lands first. Resolves undefined on timeout — callers map that to a safe
  // empty. Handles empty arrays/objects correctly (a known pitfall of the
  // classic variable observer).
  function awaitChannel (varName, cbName, timeoutMs, accept) {
    var cancel = null
    var promise = new Promise(function (resolve) {
      if (!W) return resolve(undefined)
      var done = false
      var stop = null
      try { delete W[varName] } catch (e) { try { W[varName] = undefined } catch (e2) {} }
      function finish (value) {
        if (done) return
        done = true
        clearInterval(timer)
        clearTimeout(cap)
        if (stop) stop()
        resolve(value)
      }
      cancel = function () { finish(undefined) }
      if (cbName) {
        stop = hub(cbName).add(function (data) {
          if (!accept || accept(data)) finish(data)
        })
      }
      var timer = setInterval(function () {
        var v = W[varName]
        if (v !== undefined && (!accept || accept(v))) finish(v)
      }, 100)
      var cap = setTimeout(function () { finish(undefined) }, timeoutMs)
    })
    promise.stop = cancel || function () {}
    return promise
  }

  // Serialize calls that share a native response channel.
  var chains = {}
  function chained (channel, task) {
    var prev = chains[channel] || Promise.resolve()
    var next = prev.then(task, task)
    chains[channel] = next.then(function (v) { return v }, function () {})
    return next
  }

  // ── V4 transport: dsx module promises ────────────────────────────────────

  function v4 () {
    try { return W.dsx.module.revenuecat } catch (e) { return null }
  }

  function v4call (action, args, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var mod = v4()
      if (!mod) return reject({ code: 'no_module' })
      var params = {}
      for (var k in args) if (args[k] !== undefined && args[k] !== null && args[k] !== '') params[k] = args[k]
      if (timeoutMs) params.__timeout = timeoutMs
      try {
        mod[action](params).then(resolve, reject)
      } catch (e) {
        reject({ code: 'call_failed', message: String(e && e.message || e) })
      }
    })
  }

  function rejection (err, source) {
    var code = err && err.code || 'error'
    return {
      ok: false,
      cancelled: code === 'user_cancelled',
      restored: false,
      source: source,
      product: null,
      transaction: null,
      entitlements: [],
      user: iap._user,
      platform: os(),
      runtime: runtime(),
      error: err && (err.message || err.error) || String(code),
      code: code
    }
  }

  // ── shape helpers ────────────────────────────────────────────────────────

  function webResult (source) {
    return {
      ok: false, cancelled: false, restored: false, source: source,
      product: null, transaction: null, entitlements: [], user: iap._user,
      platform: 'web', runtime: 0, error: 'Not running inside a Despia app.', code: 'web'
    }
  }

  function emptyStatus (code, error) {
    return {
      ok: false, active: [], all: [], subscriptions: [], purchases: [],
      user: iap._user, anonymous: !iap._user, management: null,
      platform: os(), runtime: runtime(), error: error || null, code: code || null
    }
  }

  function keepProject (envelope) {
    try {
      if (envelope && envelope.project && !iap.project) iap.project = envelope.project
      // An envelope with runtime:3 proves this V3 build carries the unified
      // bridge — safe to use the identity session schemes from here on.
      if (envelope && envelope.runtime === 3) {
        iap._v3 = true
        v3bind()
      }
    } catch (e) {}
    return envelope
  }

  // Deferred V3 session bind: fire the native login only once the build has
  // proven (by answering an envelope) that it carries the identity bridge —
  // old builds never see the probe, so they never show a stray prompt.
  function v3bind () {
    if (!iap._v3 || !iap._user || iap._v3bound || runtime() !== 3) return
    iap._v3bound = true
    fire('revenuecat://login?external_id=' + encodeURIComponent(iap._user))
  }

  // Map the V4 module's RC-flavored product row (older builds without the
  // `catalog` action) onto the unified product shape.
  function mapV4Product (p) {
    var id = p && p.id || ''
    var colon = id.indexOf(':')
    var sub = p && p.subscription || null
    var intro = p && p.introductory_offer || null
    return {
      id: id,
      sku: colon >= 0 ? id.slice(0, colon) : id,
      plan: colon >= 0 ? id.slice(colon + 1) : null,
      type: p && p.type === 'subscription' ? 'subscription' : 'product',
      title: p && p.title || '',
      desc: p && p.description || '',
      price: p && p.price && p.price.amount || 0,
      priceString: p && p.price && p.price.formatted || '',
      currency: p && p.price && p.price.currency || null,
      period: sub && sub.period || null,
      periodUnit: sub && sub.period_unit || null,
      periodCount: sub && sub.period_count || null,
      intro: intro ? {
        price: intro.price && intro.price.amount || 0,
        priceString: intro.price && intro.price.formatted || '',
        period: intro.period || null,
        periodUnit: intro.period_unit || null,
        periodCount: intro.period_count || null,
        cycles: intro.cycles || 1,
        type: intro.payment_mode === 'free_trial' ? 'trial' : 'intro'
      } : null,
      offering: null, package: null, packageType: null
    }
  }

  function historyStatus (rows) {
    rows = Array.isArray(rows) ? rows : []
    var active = []
    var all = []
    for (var i = 0; i < rows.length; i++) {
      var ent = rows[i] && rows[i].entitlementId
      if (!ent) continue
      if (all.indexOf(ent) === -1) all.push(ent)
      if (rows[i].isActive && active.indexOf(ent) === -1) active.push(ent)
    }
    return {
      ok: true, active: active, all: all,
      subscriptions: [], purchases: rows,
      user: iap._user, anonymous: !iap._user, management: null,
      platform: os(), runtime: runtime(), error: null, code: null
    }
  }

  function customerStatus (envelope, rows) {
    var ents = envelope && envelope.entitlements || {}
    keepProject(envelope)
    return {
      ok: envelope.ok !== false,
      active: ents.active || [],
      all: ents.all || [],
      subscriptions: envelope.subscriptions || [],
      purchases: Array.isArray(rows) ? rows : [],
      user: envelope.user || iap._user,
      anonymous: envelope.anonymous !== false,
      management: envelope.management || null,
      platform: envelope.platform || os(),
      runtime: envelope.runtime || runtime(),
      error: envelope.error || null,
      code: envelope.code || null
    }
  }

  // ── plans: the nested view over the unified catalog envelope ────────────
  // Wire format stays flat and stable across three native codebases; the
  // pretty shape is computed here (presentation lives in the adapter).

  var KIND = { weekly: 'weekly', monthly: 'monthly', annual: 'annual', lifetime: 'lifetime' }
  var UNIT_DAYS = { day: 1, week: 7, month: 30, year: 365 }

  function nestPrice (value, text, currency) {
    return { value: value || 0, text: text || '', currency: currency || null }
  }

  function nestPeriod (iso, unit, value) {
    if (!iso && !unit) return null
    return { iso: iso || null, value: value == null ? 1 : value, unit: unit || null }
  }

  function toPlan (product) {
    var intro = product.intro || null
    var trial = null
    var introOut = null
    if (intro && intro.type === 'trial') {
      trial = {
        days: (UNIT_DAYS[intro.periodUnit] || 1) * (intro.periodCount == null ? 1 : intro.periodCount),
        // null = unknown here; the store enforces eligibility at purchase time
        // (P2 native eligibility turns this into a real boolean on iOS).
        eligible: null
      }
    } else if (intro) {
      introOut = {
        // Heuristic until the envelope carries Apple's paymentMode natively:
        // pay-as-you-go bills the intro price for multiple cycles, pay-up-front once.
        type: intro.cycles > 1 ? 'payg' : 'upfront',
        eligible: null,
        price: nestPrice(intro.price, intro.priceString, product.currency),
        period: nestPeriod(intro.period, intro.periodUnit, intro.periodCount),
        cycles: intro.cycles == null ? 1 : intro.cycles
      }
    }
    return {
      id: KIND[product.packageType] || null,       // finalized in buildPlans
      rcId: product.package || null,
      product: product.id,
      type: product.type,
      kind: KIND[product.packageType] || 'custom',
      title: product.title,
      desc: product.desc,
      price: nestPrice(product.price, product.priceString, product.currency),
      period: nestPeriod(product.period, product.periodUnit, product.periodCount),
      trial: trial,
      intro: introOut,
      offers: Array.isArray(product.offers) ? product.offers : []
    }
  }

  function buildPlans (envelope) {
    var products = envelope && envelope.products || []
    var plans = []
    for (var i = 0; i < products.length; i++) plans.push(toPlan(products[i]))
    var counts = {}
    var j
    for (j = 0; j < plans.length; j++) {
      if (!plans[j].id) plans[j].id = stripRc(plans[j].rcId) || plans[j].product
      counts[plans[j].id] = (counts[plans[j].id] || 0) + 1
    }
    for (j = 0; j < plans.length; j++) {
      if (counts[plans[j].id] > 1) plans[j].id = stripRc(plans[j].rcId) || plans[j].product
    }
    var seen = {}
    for (j = 0; j < plans.length; j++) {
      if (seen[plans[j].id]) plans[j].id = plans[j].product
      seen[plans[j].id] = true
    }
    return plans
  }

  function stripRc (rcId) {
    if (!rcId) return null
    return rcId.indexOf('$rc_') === 0 ? rcId.slice(4) : rcId
  }

  function findPlan (plans, x) {
    if (!plans) return null
    for (var i = 0; i < plans.length; i++) {
      var pl = plans[i]
      if (pl.id === x || pl.rcId === x || pl.product === x || pl.kind === x) return pl
    }
    return null
  }

  // ── the API ──────────────────────────────────────────────────────────────

  var iap = {

    debug: false,

    // The RevenueCat app user id used for every purchase, paywall, and
    // entitlement call. Set it once with user(id).
    _user: null,

    // The current app user id (null when anonymous).
    get id () { return this._user },

    // The RevenueCat project id, auto-filled from the native envelope when the
    // Global project ID is configured in Despia > Your App > Integrations.
    project: null,

    // true when running inside a Despia-built native app (V3 or V4).
    get native () { return runtime() !== 0 },

    // 'ios' | 'android' | 'web'
    get os () { return os() },

    // 4 (Despia Framework) | 3 (classic Despia) | 0 (browser)
    get runtime () { return runtime() },

    // Resolves { native, os, runtime, user, project } — handy on app start.
    ready: function () {
      var self = this
      return Promise.resolve().then(function () {
        return { native: self.native, os: os(), runtime: runtime(), user: self._user, project: self.project }
      })
    },

    // Identify the current user to RevenueCat — the everyday call:
    //   await revenuecat.user(base44User.id)
    // Use your Base44 user's stable id (not an email) so client purchases and
    // your server-side checks always name the same RevenueCat customer.
    // Switching accounts is just another user(newId) — no logout in between
    // (RevenueCat supports logIn() straight from another identified user).
    // With no argument, resolves the current identity.
    user: function (id) {
      var self = this
      if (arguments.length === 0 || id === undefined) {
        return Promise.resolve({ user: self._user, anonymous: !self._user })
      }
      self._user = id == null || id === '' ? null : String(id)
      self._v3bound = false
      if (self._user && runtime() === 4) {
        // Forward-compatible session bind, fire-and-forget: newer builds carry
        // a native login action that merges anonymous history immediately;
        // older builds reject/timeout silently and we stay in per-call
        // identity mode (still correctly attributed). Never block app boot on
        // the probe.
        v4call('login', { external_id: self._user }, 8000).catch(function () {})
      }
      if (self._user && runtime() === 3) {
        v3bind()   // fires only once a unified envelope has proven the build
      }
      return Promise.resolve({ user: self._user, anonymous: !self._user })
    },

    // Alias of user(id).
    login: function (id) {
      return this.user(id)
    },

    // Clear the current identity. On newer builds this also rotates the
    // native RevenueCat user to a fresh anonymous id; on older builds the
    // package stops sending the id (see SPEC.md §3) — apps with accounts
    // should gate on their own auth state too:
    //   const premium = user && await revenuecat.has('premium')
    logout: function () {
      this._user = null
      this._catalog = null
      this._v3bound = false
      if (runtime() === 4) {
        // Fire-and-forget: newer builds rotate the native RevenueCat user to
        // a fresh anonymous id; older builds ignore it. The local clear above
        // is what stops this package from sending the old id either way.
        v4call('logout', {}, 8000).catch(function () {})
      }
      if (runtime() === 3 && this._v3) {
        fire('revenuecat://logout')   // build proven — rotate the native user too
      }
      return Promise.resolve({ user: null, anonymous: true })
    },

    // V3 capability facts, learned from envelopes (see keepProject/v3bind).
    _v3: false,
    _v3bound: false,

    // All products across your RevenueCat offerings, with live store pricing
    // (localized price string, currency, period, free-trial/intro phases) in
    // one unified JSON shape on both iOS and Android. Pass an offering id to
    // filter. product.id feeds straight into buy().
    products: function (offering) {
      return this.offers(offering).then(function (envelope) {
        return envelope && envelope.products || []
      })
    },

    // Remember the last good catalog so buy('monthly') can resolve plan ids
    // without another native roundtrip.
    _cache: function (envelope) {
      if (envelope && (envelope.ok !== false || (envelope.products && envelope.products.length))) {
        this._catalog = { envelope: envelope, plans: buildPlans(envelope) }
      }
      return envelope
    },

    // The full catalog envelope: { ok, current, offerings: [{ id, current,
    // packages: [{ id, type, product }] }], products: [...] } plus platform,
    // runtime, user, and project metadata.
    offers: function (offering) {
      var self = this
      var rt = runtime()
      if (rt === 0) {
        return Promise.resolve({ ok: false, current: null, offerings: [], products: [], platform: 'web', runtime: 0, user: self._user, project: self.project, error: 'Not running inside a Despia app.', code: 'web' })
      }
      if (rt === 4) {
        return v4call('catalog', { external_id: self._user, offering: offering }, 8000)
          .then(keepProject)
          .catch(function (err) {
            // Older V4 build without `catalog` — fall back to the products action.
            warn('catalog unavailable (' + (err && err.code) + '), falling back to products()')
            return v4call('products', {}, 8000).then(function (rows) {
              var products = (Array.isArray(rows) ? rows : []).map(mapV4Product)
              return { ok: true, current: null, offerings: [], products: products, platform: os(), runtime: 4, user: self._user, project: self.project, error: null, code: null }
            }).catch(function (e2) {
              return { ok: false, current: null, offerings: [], products: [], platform: os(), runtime: 4, user: self._user, project: self.project, error: e2 && e2.message || 'catalog failed', code: e2 && e2.code || 'error' }
            })
          })
          .then(function (envelope) { return self._cache(envelope) })
      }
      return chained('products', function () {
        var cmd = 'revenuecat://products'
        var q = []
        if (self._user) q.push('external_id=' + encodeURIComponent(self._user))
        if (offering) q.push('offering=' + encodeURIComponent(offering))
        if (q.length) cmd += '?' + q.join('&')
        fire(cmd)
        return awaitChannel('revenueCatProducts', 'onRevenueCatProducts', 15000)
      }).then(function (envelope) {
        if (!envelope) {
          warn('products query timed out — rebuild your app in Despia to get the latest RevenueCat bridge')
          return { ok: false, current: null, offerings: [], products: [], platform: os(), runtime: 3, user: self._user, project: self.project, error: 'No response from the native layer.', code: 'timeout' }
        }
        return keepProject(envelope)
      }).then(function (envelope) { return self._cache(envelope) })
    },

    // Your subscription plans, shaped for rendering a paywall screen:
    //   [{ id: 'monthly', title, price: { value, text, currency },
    //      period: { iso, value, unit }, trial: { days, eligible },
    //      intro, offers, product, rcId, kind, type }]
    // price.text is ALWAYS the value to display — localized by the store.
    // plan.id (or the whole plan / its product id) feeds straight into buy().
    plans: function (offering) {
      var self = this
      return this.offers(offering).then(function (envelope) {
        if (self._catalog && self._catalog.envelope === envelope) return self._catalog.plans
        return buildPlans(envelope)
      })
    },

    _catalog: null,

    // Resolve a buy() argument — plan id ('monthly'), kind, '$rc_' package id,
    // or store product id — to the underlying store product id.
    _resolve: function (x) {
      var self = this
      var s = String(x && x.product || x)     // accept a whole plan object too
      var hit = findPlan(self._catalog && self._catalog.plans, s)
      if (hit) return Promise.resolve(hit.product)
      // Reverse-DNS or base-plan-qualified ids are store product ids already —
      // don't spend a catalog roundtrip on them.
      if (s.indexOf(':') !== -1 || s.indexOf('.') !== -1) return Promise.resolve(s)
      if (self._catalog) return Promise.resolve(s)
      return self.plans().then(function (plans) {
        var found = findPlan(plans, s)
        return found ? found.product : s
      }).catch(function () { return s })
    },

    // Native purchase. Accepts a plan id from plans() ('monthly'), a store
    // product id from products(), or a whole plan object. Resolves when the
    // store sheet settles: { ok, cancelled, product, transaction,
    // entitlements, error, code }. Never rejects. Free trials and intro
    // offers apply automatically when the store deems the user eligible.
    // options.offer names a specific promotional / Google offer id — it is
    // forwarded to the native layer (honored on builds that support explicit
    // offers; ignored, falling back to default offer logic, on older builds).
    buy: function (product, options) {
      var self = this
      var rt = runtime()
      var offer = options && options.offer ? String(options.offer) : null
      if (!product) return Promise.resolve(rejection({ code: 'missing_param', message: 'buy(product) needs a product or plan id.' }, 'purchase'))
      if (rt === 0) return Promise.resolve(webResult('purchase'))
      return this._resolve(product).then(function (productId) {
        if (rt === 4) {
          var args = { external_id: self._user || self._anon(), product: productId }
          if (offer) args.offer = offer
          return v4call('purchase', args, 600000)
            .then(function (data) {
              return {
                ok: true, cancelled: false, restored: false, source: 'purchase',
                product: data && data.product_id || productId,
                transaction: data && data.transaction && data.transaction.id || null,
                entitlements: data && data.active_entitlements || [],
                user: self._user, platform: os(), runtime: 4, error: null, code: null
              }
            })
            .catch(function (err) { return rejection(err, 'purchase') })
        }
        return chained('result', function () {
          var cmd = 'revenuecat://purchase?external_id=' + encodeURIComponent(self._user || self._anon()) +
               '&product=' + encodeURIComponent(productId)
          if (offer) cmd += '&offer=' + encodeURIComponent(offer)
          fire(cmd)
          return awaitChannel('revenueCatResult', 'onRevenueCatResult', 600000, function (r) {
            return r && r.source === 'purchase'
          })
        }).then(function (result) {
          if (!result) return rejection({ code: 'timeout', message: 'No purchase result from the native layer.' }, 'purchase')
          return result
        })
      })
    },

    // RevenueCat's native paywall (built in the RevenueCat dashboard, priced
    // by the store in each user's currency). Resolves once per presentation:
    // purchased ({ ok: true }), restored ({ ok: true, restored: true }),
    // or closed without buying ({ ok: false, cancelled: true }).
    paywall: function (offering) {
      var self = this
      var rt = runtime()
      if (rt === 0) return Promise.resolve(webResult('paywall'))
      return chained('result', function () {
        return new Promise(function (resolve) {
          var done = false
          var wait = awaitChannel('revenueCatResult', 'onRevenueCatResult', 1800000, function (r) {
            return r && r.source === 'paywall'
          })
          function settle (result) {
            if (done) return
            done = true
            wait.stop()
            resolve(result)
          }
          wait.then(function (result) {
            settle(result || rejection({ code: 'timeout', message: 'No paywall result from the native layer.' }, 'paywall'))
          })
          if (rt === 4) {
            // The V4 action settles at presentation; only a rejection (paywall
            // never shown) ends the wait early — the outcome rides the shared
            // result channel exactly like V3.
            v4call('paywall', { external_id: self._user || self._anon(), offering: offering }, 20000)
              .catch(function (err) { settle(rejection(err, 'paywall')) })
          } else {
            var cmd = 'revenuecat://launchPaywall?external_id=' + encodeURIComponent(self._user || self._anon())
            if (offering) cmd += '&offering=' + encodeURIComponent(offering)
            fire(cmd)
          }
        })
      })
    },

    // RevenueCat Customer Center — native manage/restore/refund UI. Resolves
    // { ok: true } when the user closes it. Subscribe to its events with
    // on('center', fn).
    center: function () {
      var self = this
      var rt = runtime()
      if (rt === 0) return Promise.resolve(webResult('center'))
      return new Promise(function (resolve) {
        var stop = hub('onRevenueCatCenter').add(function (event) {
          if (event && event.event === 'dismissed') {
            stop()
            clearTimeout(cap)
            resolve({ ok: true, source: 'center', platform: os(), runtime: rt, error: null, code: null })
          }
        })
        var cap = setTimeout(function () {
          stop()
          resolve({ ok: true, source: 'center', platform: os(), runtime: rt, error: null, code: 'timeout' })
        }, 1800000)
        if (rt === 4) {
          v4call('center', { external_id: self._user }, 20000).catch(function () {})
        } else {
          fire(self._user ? 'revenuecat://center?external_id=' + encodeURIComponent(self._user) : 'revenuecat://center')
        }
      })
    },

    // Entitlement status from RevenueCat + the device's store history:
    // { ok, active: ['premium'], all, subscriptions, purchases, management }.
    status: function () {
      var self = this
      var rt = runtime()
      if (rt === 0) return Promise.resolve(emptyStatus('web', 'Not running inside a Despia app.'))
      if (rt === 4) {
        return Promise.all([
          v4call('customer', { external_id: self._user }, 8000).catch(function () { return null }),
          v4call('history', {}, 8000).catch(function () { return null })
        ]).then(function (parts) {
          var envelope = parts[0]
          var rows = parts[1]
          if (envelope) return customerStatus(envelope, rows)
          if (rows) return historyStatus(rows)
          return emptyStatus('timeout', 'No response from the native layer.')
        })
      }
      return chained('customer', function () {
        fire(self._user ? 'revenuecat://customer?external_id=' + encodeURIComponent(self._user) : 'revenuecat://customer')
        return awaitChannel('revenueCatCustomer', 'onRevenueCatCustomer', 8000)
      }).then(function (envelope) {
        if (envelope) {
          return self.restore().then(function (r) {
            return customerStatus(envelope, r && r.purchases || [])
          })
        }
        // Older V3 build without revenuecat://customer — the store history
        // still answers the entitlement question.
        return self.restore()
      })
    },

    // Restore purchases: re-reads the device's store history (required by App
    // Store review) and returns the same status shape as status().
    restore: function () {
      var rt = runtime()
      if (rt === 0) return Promise.resolve(emptyStatus('web', 'Not running inside a Despia app.'))
      if (rt === 4) {
        return v4call('history', {}, 15000)
          .then(historyStatus)
          .catch(function (err) { return emptyStatus(err && err.code || 'error', err && err.message || null) })
      }
      return chained('history', function () {
        fire('getpurchasehistory://')
        return awaitChannel('restoredData', null, 15000)
      }).then(function (rows) {
        if (rows === undefined) return emptyStatus('timeout', 'No purchase history from the native layer.')
        return historyStatus(rows)
      })
    },

    // The one-liner gate: does this user have an active entitlement?
    //   if (await iap.has('premium')) unlockPremium()
    has: function (entitlement) {
      return this.status().then(function (s) {
        return !!(s && s.active && s.active.indexOf(String(entitlement)) !== -1)
      })
    },

    // Normalized full customer state — status() plus a per-entitlement map:
    //   { user, active: ['premium'], entitlements: { premium: { active,
    //     product, period, bought, expires, renews } }, manage }
    // period is 'trial' | 'intro' | 'promo' | 'normal' when the runtime
    // reports it, else null.
    info: function () {
      var self = this
      return this.status().then(function (s) {
        var map = {}
        var rows = s.purchases || []
        var ids = s.all && s.all.length ? s.all : s.active || []
        for (var i = 0; i < ids.length; i++) {
          var id = ids[i]
          var row = null
          for (var j = 0; j < rows.length; j++) {
            if (rows[j] && rows[j].entitlementId === id) { row = rows[j]; break }
          }
          var period = null
          if (row && row.entitlement && row.entitlement.period_type) {
            var pt = String(row.entitlement.period_type)
            period = pt === 'normal' ? 'normal' : pt === 'trial' ? 'trial' : pt === 'intro' ? 'intro' : pt === 'promotional' ? 'promo' : pt
          }
          map[id] = {
            active: !!(s.active && s.active.indexOf(id) !== -1),
            product: row ? row.productId : null,
            period: period,
            bought: row ? row.purchaseDate || null : null,
            expires: row ? row.expirationDate || null : null,
            renews: row ? !!row.willRenew : false
          }
        }
        return {
          ok: s.ok,
          user: s.user || self._user,
          anonymous: s.anonymous,
          active: s.active || [],
          entitlements: map,
          subscriptions: s.subscriptions || [],
          manage: s.management || null,
          platform: s.platform,
          runtime: s.runtime,
          error: s.error,
          code: s.code
        }
      })
    },

    // Apple subscription offer-code redemption (iOS). Opens the native
    // redemption sheet on builds that carry the redeem bridge; resolves
    // { supported: false } everywhere else (Google Play has no in-app
    // equivalent — Play codes are redeemed in the Play Store app).
    redeem: function () {
      var self = this
      var rt = runtime()
      var unsupported = { ok: false, supported: false, source: 'redeem', platform: os(), runtime: rt, error: null, code: 'unsupported' }
      if (rt === 0 || os() === 'android') return Promise.resolve(unsupported)
      if (rt === 4) {
        return v4call('redeem', {}, 8000)
          .then(function () { return { ok: true, supported: true, source: 'redeem', platform: os(), runtime: 4, error: null, code: null } })
          .catch(function () { return unsupported })
      }
      return chained('result', function () {
        fire('revenuecat://redeem')
        // Newer builds ack presentation on the result channel; silence means
        // the build predates the redeem bridge.
        return awaitChannel('revenueCatResult', 'onRevenueCatResult', 8000, function (r) {
          return r && r.source === 'redeem'
        })
      }).then(function (result) {
        if (!result) return unsupported
        return { ok: result.ok !== false, supported: true, source: 'redeem', platform: os(), runtime: 3, error: result.error || null, code: result.code || null }
      })
    },

    // Events: 'result' (every purchase/paywall outcome), 'purchase' (store
    // confirmed a transaction / customer info changed), 'center' (Customer
    // Center activity). Returns an unsubscribe function.
    on: function (event, fn) {
      if (typeof fn !== 'function') return function () {}
      var cb = event === 'result' ? 'onRevenueCatResult'
        : event === 'purchase' ? 'onRevenueCatPurchase'
        : event === 'center' ? 'onRevenueCatCenter'
        : null
      if (!cb) { warn("unknown event '" + event + "'"); return function () {} }
      var remove = hub(cb).add(fn)
      ;(this._subs[event] = this._subs[event] || []).push({ fn: fn, remove: remove })
      return remove
    },

    off: function (event, fn) {
      var subs = this._subs[event] || []
      for (var i = subs.length - 1; i >= 0; i--) {
        if (!fn || subs[i].fn === fn) {
          subs[i].remove()
          subs.splice(i, 1)
        }
      }
    },

    _subs: {},

    // Stable anonymous id so purchases made before login() still belong to one
    // RevenueCat customer on this device.
    _anon: function () {
      try {
        var store = W && W.localStorage
        var id = store && store.getItem('b44rc_anon')
        if (!id) {
          id = 'b44_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
          if (store) store.setItem('b44rc_anon', id)
        }
        return id
      } catch (e) {
        return 'b44_anon'
      }
    }
  }

  return iap
}))
