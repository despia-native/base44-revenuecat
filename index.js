// base44-revenuecat: RevenueCat in-app purchases & subscriptions for Base44
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
// and safely no-ops in a plain browser (Base44 preview), every call resolves,
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
      // The module bus is the strongest signal, and it is enough on its own:
      // the wire flag and the bus are set by the same runtime but not
      // necessarily in the same tick, so requiring both can misread a
      // Framework app as classic and fire scheme navigations at it.
      if (W.dsx && W.dsx.module) return 4
      if (W.__dsxWire) return 4
      var ua = (W.navigator && W.navigator.userAgent || '').toLowerCase()
      if (ua.indexOf('despia') !== -1) return 3
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
    // Successive scheme navigations can swallow each other on iOS, space them.
    setTimeout(function () { draining = false; drain() }, 80)
  }

  // Await `window[varName]` (poll) and/or `window[cbName]` (push), whichever
  // lands first. Resolves undefined on timeout, callers map that to a safe
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
      // Capability facts ride every envelope (any runtime): `bridge` is the
      // native bridge version, 2 = whoami identity read + purchases/paywalls
      // that fall back to RevenueCat's own anonymous user.
      if (envelope && envelope.bridge > iap._bridge) iap._bridge = envelope.bridge
      // An envelope with runtime:3 proves this V3 build carries the unified
      // bridge, safe to use the identity session schemes from here on.
      if (envelope && envelope.runtime === 3) {
        iap._v3 = true
        v3bind()
      }
    } catch (e) {}
    return envelope
  }

  // Deferred V3 session bind: fire the native login only once the build has
  // proven (by answering an envelope) that it carries the identity bridge:
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

  // Build a catalog envelope from the V4 `offerings` action, the read that
  // predates `catalog` on older Framework builds. It carries offering and
  // package placement, which the flat `products` action does not.
  function mapV4Offerings (data) {
    var all = data && data.all || []
    var offerings = []
    var products = []
    var seen = {}
    for (var i = 0; i < all.length; i++) {
      var off = all[i] || {}
      var pkgs = off.packages || []
      var rows = []
      for (var j = 0; j < pkgs.length; j++) {
        var pkg = pkgs[j] || {}
        var product = mapV4Product(pkg.product)
        product.offering = off.id || null
        product.package = pkg.id || null
        product.packageType = pkg.type || null
        rows.push({ id: pkg.id || '', type: pkg.type || '', product: product })
        if (product.id && !seen[product.id]) {
          seen[product.id] = 1
          products.push(product)
        }
      }
      offerings.push({ id: off.id || '', current: off.id === (data && data.current), packages: rows })
    }
    return {
      ok: true, current: data && data.current || null,
      offerings: offerings, products: products,
      platform: os(), runtime: 4, user: iap._user, project: iap.project,
      error: null, code: null
    }
  }

  // Build a catalog envelope from the classic `revenuecat://offerings` read,
  // the legacy catalog channel that predates revenuecat://products. Its rows
  // are a different shape (packageId / productId / priceString / introOffer),
  // and its answer rides window.offeringsData with a no-argument callback.
  var V3_PERIOD_UNIT = { day: 'day', week: 'week', month: 'month', year: 'year' }

  function mapV3OfferingRow (row) {
    var id = row && row.productId || ''
    var colon = id.indexOf(':')
    var period = row && row.period || null
    var intro = row && row.introOffer || null
    var introPeriod = intro && intro.period || null
    return {
      id: id,
      sku: colon >= 0 ? id.slice(0, colon) : id,
      plan: colon >= 0 ? id.slice(colon + 1) : null,
      type: period ? 'subscription' : 'product',
      title: row && row.title || '',
      desc: '',
      price: typeof (row && row.price) === 'number' ? row.price : parseFloat(row && row.price) || 0,
      priceString: row && row.priceString || '',
      currency: row && row.currency || null,
      period: period && period.iso8601 || null,
      periodUnit: period && V3_PERIOD_UNIT[period.unit] || null,
      periodCount: period && period.value || null,
      intro: intro ? {
        price: 0,
        priceString: intro.priceString || '',
        period: introPeriod && introPeriod.iso8601 || null,
        periodUnit: introPeriod && V3_PERIOD_UNIT[introPeriod.unit] || null,
        periodCount: introPeriod && introPeriod.value || null,
        cycles: 1,
        type: intro.type === 'free_trial' ? 'trial' : 'intro'
      } : null,
      offering: null,
      package: row && row.packageId || null,
      packageType: row && row.packageType ? String(row.packageType).toLowerCase() : null
    }
  }

  function mapV3Offerings (rows, err) {
    var products = []
    var packages = []
    rows = Array.isArray(rows) ? rows : []
    for (var i = 0; i < rows.length; i++) {
      var product = mapV3OfferingRow(rows[i])
      products.push(product)
      packages.push({ id: product.package || '', type: product.packageType || '', product: product })
    }
    return {
      ok: !err && products.length > 0,
      current: null,
      offerings: packages.length ? [{ id: '', current: true, packages: packages }] : [],
      products: products,
      platform: os(), runtime: 3, user: iap._user, project: iap.project,
      error: err && err.message || null,
      code: err && err.code || null
    }
  }

  // Status from the V4 `entitlements` action, whose rows are RC-flavored
  // ({ id, is_active, product_id, ... }) rather than the unified envelope.
  function entitlementsStatus (data, rows) {
    var active = []
    var all = []
    var subscriptions = []
    var list = data && data.all || []
    var live = data && data.active || []
    var i
    for (i = 0; i < list.length; i++) {
      var id = list[i] && list[i].id
      if (id && all.indexOf(id) === -1) all.push(id)
    }
    for (i = 0; i < live.length; i++) {
      var a = live[i] || {}
      if (a.id && active.indexOf(a.id) === -1) active.push(a.id)
      if (a.product_id && subscriptions.indexOf(a.product_id) === -1) subscriptions.push(a.product_id)
      if (a.id && all.indexOf(a.id) === -1) all.push(a.id)
    }
    return {
      ok: true, active: active, all: all,
      subscriptions: subscriptions,
      purchases: Array.isArray(rows) ? rows : [],
      user: iap._user, anonymous: !iap._user, management: null,
      platform: os(), runtime: runtime(), error: null, code: null
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

    // Resolves { native, os, runtime, user, project }, handy on app start.
    ready: function () {
      var self = this
      return Promise.resolve().then(function () {
        return { native: self.native, os: os(), runtime: runtime(), user: self._user, project: self.project }
      })
    },

    // Normalize a native identity report into the shape user() resolves:
    // { id, user, anonymous, registered }. `id` is the raw RevenueCat app
    // user id (anonymous "$RCAnonymousID:..." ids included), `user` is the id
    // you bound (null when anonymous). An id the app set locally this session
    // always wins; a login the native SDK persisted across restarts is
    // adopted so purchases and server checks keep naming the same customer.
    _identity: function (raw, anon) {
      var self = this
      var id = raw == null || raw === '' ? null : String(raw)
      if (id && anon === false && !self._user) self._user = id
      var user = self._user || (anon === false ? id : null)
      return { id: id || user, user: user, anonymous: !user, registered: !!user }
    },

    // Identify the current user to RevenueCat, the everyday call:
    //   await revenuecat.user(base44User.id)
    // Use your Base44 user's stable id (not an email) so client purchases and
    // your server-side checks always name the same RevenueCat customer.
    // Switching accounts is just another user(newId), no logout in between
    // (RevenueCat supports logIn() straight from another identified user).
    // With no argument, resolves the current identity, asking the native
    // RevenueCat SDK who it thinks the user is (registered or anonymous) on
    // builds that support the read, falling back to local state elsewhere.
    user: function (id) {
      var self = this
      if (arguments.length === 0 || id === undefined) {
        var rt = runtime()
        if (rt === 4) {
          return v4call('whoami', {}, 8000).then(function (d) {
            return self._identity(d && d.app_user_id, !!(d && d.is_anonymous))
          }).catch(function () { return self._identity(null, void 0) })
        }
        if (rt === 3 && self._bridge >= 2) {
          // Only fire the scheme once an envelope has stamped bridge >= 2:
          // older builds route unknown revenuecat:// actions into the
          // purchase catch-all, which must never happen for a read.
          return chained('user', function () {
            fire('revenuecat://whoami')
            return awaitChannel('revenueCatUser', 'onRevenueCatUser', 8000)
          }).then(function (envelope) {
            if (!envelope) return self._identity(null, void 0)
            keepProject(envelope)
            return self._identity(envelope.user, envelope.anonymous !== false)
          })
        }
        return Promise.resolve(self._identity(null, void 0))
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
      return Promise.resolve({ id: self._user, user: self._user, anonymous: !self._user, registered: !!self._user })
    },

    // Alias of user(id).
    login: function (id) {
      return this.user(id)
    },

    // Clear the current identity. On newer builds this also rotates the
    // native RevenueCat user to a fresh anonymous id; on older builds the
    // package stops sending the id (see SPEC.md §3), apps with accounts
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
        fire('revenuecat://logout')   // build proven, rotate the native user too
      }
      return Promise.resolve({ id: null, user: null, anonymous: true, registered: false })
    },

    // V3 capability facts, learned from envelopes (see keepProject/v3bind).
    _v3: false,
    _v3bound: false,

    // Native bridge capability version, learned from any envelope on any
    // runtime: 2 = whoami identity read + anonymous purchase fallback.
    // 0 = unknown or an older build (the package then synthesizes an id for
    // purchases, since those builds require external_id).
    _bridge: 0,

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
            // Older V4 build without `catalog`. Try `offerings` next, which
            // still carries offering and package placement, and only then the
            // flat `products` action.
            warn('catalog unavailable (' + (err && err.code) + '), falling back to offerings()')
            return v4call('offerings', {}, 8000).then(function (data) {
              var envelope = mapV4Offerings(data)
              if (!envelope.products.length) throw { code: 'empty' }
              return envelope
            }).catch(function () {
              return v4call('products', {}, 8000).then(function (rows) {
                var products = (Array.isArray(rows) ? rows : []).map(mapV4Product)
                return { ok: true, current: null, offerings: [], products: products, platform: os(), runtime: 4, user: self._user, project: self.project, error: null, code: null }
              }).catch(function (e2) {
                return { ok: false, current: null, offerings: [], products: [], platform: os(), runtime: 4, user: self._user, project: self.project, error: e2 && e2.message || 'catalog failed', code: e2 && e2.code || 'error' }
              })
            })
          })
          .then(function (envelope) {
            if (offering && envelope && envelope.offerings && envelope.offerings.length) {
              // The fallback reads ignore the filter, so apply it here.
              var kept = envelope.offerings.filter(function (o) { return o.id === offering })
              if (kept.length && kept.length !== envelope.offerings.length) {
                envelope.offerings = kept
                envelope.products = kept[0].packages.map(function (p) { return p.product })
              }
            }
            return self._cache(envelope)
          })
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
        if (envelope) return keepProject(envelope)
        // Older classic build without the unified products read. The legacy
        // offerings channel predates it and answers a different shape, so a
        // paywall can still be rendered on those binaries.
        warn('products query timed out, trying the legacy offerings read (rebuild in Despia for the full catalog API)')
        return self._v3Offerings(offering)
      }).then(function (envelope) { return self._cache(envelope) })
    },

    // The legacy classic-runtime catalog read. Answers on window.offeringsData
    // with window.offeringsError, and its callback takes no argument, so the
    // data is read off the window either way.
    _v3Offerings: function (offering) {
      var self = this
      return chained('offerings', function () {
        try { if (W) { delete W.offeringsError } } catch (e) {}
        fire('revenuecat://offerings' + (offering ? '?offering=' + encodeURIComponent(offering) : ''))
        return awaitChannel('offeringsData', 'onRevenueCatOfferings', 10000)
      }).then(function (rows) {
        var err = null
        // This channel's callback is invoked with NO argument, so the payload
        // is only ever on the window: read it there when the wait resolved
        // empty (the callback beat the poll).
        try {
          if (rows === undefined && W) rows = W.offeringsData
          err = W && W.offeringsError
        } catch (e) {}
        if (!rows && !err) {
          return { ok: false, current: null, offerings: [], products: [], platform: os(), runtime: 3, user: self._user, project: self.project, error: 'No response from the native layer.', code: 'timeout' }
        }
        return mapV3Offerings(rows, err)
      })
    },

    // Your subscription plans, shaped for rendering a paywall screen:
    //   [{ id: 'monthly', title, price: { value, text, currency },
    //      period: { iso, value, unit }, trial: { days, eligible },
    //      intro, offers, product, rcId, kind, type }]
    // price.text is ALWAYS the value to display, localized by the store.
    // plan.id (or the whole plan / its product id) feeds straight into buy().
    plans: function (offering) {
      var self = this
      return this.offers(offering).then(function (envelope) {
        if (self._catalog && self._catalog.envelope === envelope) return self._catalog.plans
        return buildPlans(envelope)
      })
    },

    _catalog: null,

    // Resolve a buy() argument, plan id ('monthly'), kind, '$rc_' package id,
    // or store product id, to the underlying store product id.
    _resolve: function (x) {
      var self = this
      var s = String(x && x.product || x)     // accept a whole plan object too
      var hit = findPlan(self._catalog && self._catalog.plans, s)
      if (hit) return Promise.resolve(hit.product)
      // Reverse-DNS or base-plan-qualified ids are store product ids already:
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
    // options.offer names a specific promotional / Google offer id, it is
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
          // No id bound: buy as the current (possibly anonymous) RevenueCat
          // user, its own best practice. Old builds that still require
          // external_id reject with missing_param (product is always sent, so
          // that can only mean the id): retry once the legacy way with a
          // synthesized anonymous id.
          var args = { product: productId }
          if (self._user) args.external_id = self._user
          if (offer) args.offer = offer
          return v4call('purchase', args, 600000)
            .catch(function (err) {
              if (self._user || !err || err.code !== 'missing_param') throw err
              var legacy = { external_id: self._anon(), product: productId }
              if (offer) legacy.offer = offer
              return v4call('purchase', legacy, 600000)
            })
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
          // Same ladder on V3: a bound id always rides along; with none, a
          // bridge >= 2 build buys as RevenueCat's own anonymous user, while
          // older builds (which require external_id) get the synthesized id.
          var parts = []
          var ext = self._user || (self._bridge >= 2 ? null : self._anon())
          if (ext) parts.push('external_id=' + encodeURIComponent(ext))
          parts.push('product=' + encodeURIComponent(productId))
          if (offer) parts.push('offer=' + encodeURIComponent(offer))
          fire('revenuecat://purchase?' + parts.join('&'))
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
            // never shown) ends the wait early, the outcome rides the shared
            // result channel exactly like V3. No id bound: present for the
            // current (possibly anonymous) RevenueCat user; old builds that
            // still require external_id reject with missing_param, retried
            // once the legacy way with a synthesized id.
            var args = { offering: offering }
            if (self._user) args.external_id = self._user
            v4call('paywall', args, 20000)
              .catch(function (err) {
                // A build that predates the `paywall` spelling still carries
                // the legacy `launchPaywall` action.
                if (err && (err.code === 'no_module' || err.code === 'call_failed' || err.code === 'unknown_action')) {
                  return v4call('launchPaywall', args, 20000)
                }
                throw err
              })
              .catch(function (err) {
                if (!self._user && err && err.code === 'missing_param') {
                  return v4call('paywall', { external_id: self._anon(), offering: offering }, 20000)
                    .catch(function (e2) {
                      if (e2 && (e2.code === 'no_module' || e2.code === 'call_failed' || e2.code === 'unknown_action')) {
                        return v4call('launchPaywall', { external_id: self._anon(), offering: offering }, 20000)
                      }
                      throw e2
                    })
                }
                throw err
              })
              .catch(function (err) { settle(rejection(err, 'paywall')) })
          } else {
            var parts = []
            var ext = self._user || (self._bridge >= 2 ? null : self._anon())
            if (ext) parts.push('external_id=' + encodeURIComponent(ext))
            if (offering) parts.push('offering=' + encodeURIComponent(offering))
            fire('revenuecat://launchPaywall' + (parts.length ? '?' + parts.join('&') : ''))
          }
        })
      })
    },

    // RevenueCat Customer Center, native manage/restore/refund UI. Resolves
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
          v4call('history', {}, 8000).catch(function () { return null }),
          // The dedicated entitlements read, for builds that predate the
          // unified `customer` envelope: real RevenueCat entitlement state
          // beats inferring it from the device's store history.
          v4call('entitlements', {}, 8000).catch(function () { return null })
        ]).then(function (parts) {
          var envelope = parts[0]
          var rows = parts[1]
          var ents = parts[2]
          if (envelope) return customerStatus(envelope, rows)
          if (ents) return entitlementsStatus(ents, rows)
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
        // Older V3 build without revenuecat://customer, the store history
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

    // Normalized full customer state, status() plus a per-entitlement map:
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
    // equivalent, Play codes are redeemed in the Play Store app).
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
      // Same deferred gate as the identity schemes: an unproven build routes
      // revenuecat://redeem into its license-gated catch-all, which can raise
      // a native alert. Only fire once an envelope has proven the bridge.
      if (!self._v3) return Promise.resolve(unsupported)
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
    // Center activity), 'user' (identity changed, native login/logout
    // settled, with the unified user envelope). Returns an unsubscribe
    // function.
    on: function (event, fn) {
      if (typeof fn !== 'function') return function () {}
      var cb = event === 'result' ? 'onRevenueCatResult'
        : event === 'purchase' ? 'onRevenueCatPurchase'
        : event === 'center' ? 'onRevenueCatCenter'
        : event === 'user' ? 'onRevenueCatUser'
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

  // Bind every method to the module so destructured usage keeps working:
  //   const { plans, buy, has } = revenuecat
  // is a natural thing to write (and for an AI builder to generate), and
  // without this it would throw on `this`. Accessors (id/native/os/runtime)
  // are left untouched.
  Object.getOwnPropertyNames(iap).forEach(function (key) {
    var d = Object.getOwnPropertyDescriptor(iap, key)
    if (d && typeof d.value === 'function') iap[key] = d.value.bind(iap)
  })

  return iap
}))
