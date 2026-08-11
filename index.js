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
      // Order matters. The Framework installs window.__dsxWire at document
      // start, before any page script, and locks it (non-writable,
      // non-configurable), so it is the one marker a page cannot fake or
      // shadow: it alone settles the question.
      if (W.__dsxWire) return 4
      // No wire but a Despia user agent means the classic runtime, because a
      // Framework app would always carry the wire by now. Checking this
      // BEFORE the bus matters: window.dsx is an ordinary writable global, so
      // a page (or another library) defining it must not be able to turn a
      // classic app into a Framework one and silently disable every purchase.
      var ua = (W.navigator && W.navigator.userAgent || '').toLowerCase()
      if (ua.indexOf('despia') !== -1) return 3
      // Neither: a non-native Framework surface still speaks the module bus.
      if (W.dsx && W.dsx.module) return 4
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

  // The Framework installs window.__dsxWire at document start and locks it
  // (non-writable, non-configurable), then binds the window.dsx facade a
  // moment later. So the wire can be present while the module bus is not
  // bound yet. When the wire says Framework, wait for the bus rather than
  // failing the call on the first miss: giving up there would resolve an
  // empty paywall on a perfectly capable app.
  var BUS_WAIT_MS = 2000

  function v4bus () {
    var mod = v4()
    if (mod) return Promise.resolve(mod)
    // The bus is already bound and RevenueCat is not on it: the module is
    // excluded from this build, so there is nothing to wait for.
    var bound = false
    try { bound = !!(W && W.dsx && W.dsx.module) } catch (e) {}
    if (bound) return Promise.resolve(null)
    var wired = false
    try { wired = !!(W && W.__dsxWire) } catch (e) {}
    if (!wired) return Promise.resolve(null)
    return new Promise(function (resolve) {
      var waited = 0
      var step = 50
      var timer = setInterval(function () {
        waited += step
        var ready = v4()
        if (ready || waited >= BUS_WAIT_MS) {
          clearInterval(timer)
          resolve(ready)
        }
      }, step)
    })
  }

  function v4call (action, args, timeoutMs) {
    return v4bus().then(function (mod) {
      return new Promise(function (resolve, reject) {
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
      // This channel reports only a display string and a payment mode: no
      // numeric price and no cycle count. Report those as unknown rather than
      // inventing a zero price and a single cycle, and carry the mode the
      // native side actually sent so a pay-as-you-go offer is not rendered as
      // pay-up-front.
      intro: intro ? {
        price: null,
        priceString: intro.priceString || '',
        period: introPeriod && introPeriod.iso8601 || null,
        periodUnit: introPeriod && V3_PERIOD_UNIT[introPeriod.unit] || null,
        periodCount: introPeriod && introPeriod.value || null,
        cycles: null,
        type: intro.type === 'free_trial' ? 'trial' : 'intro',
        mode: intro.type === 'free_trial' ? 'trial'
          : intro.type === 'pay_as_you_go' ? 'payg'
            : intro.type === 'pay_up_front' ? 'upfront' : null
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
    var empty = !err && products.length === 0
    return {
      ok: !err && products.length > 0,
      current: null,
      offerings: packages.length ? [{ id: '', current: true, packages: packages }] : [],
      products: products,
      platform: os(), runtime: 3, user: iap._user, project: iap.project,
      // An empty answer is still an answer: give the caller something to show
      // and branch on rather than ok:false with nothing in it.
      error: err && err.message || (empty ? 'No offering is available to show.' : null),
      code: err && err.code || (empty ? 'offeringNotFoundError' : null)
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

  // The info() envelope, shared by the native-detail path and the older
  // history-inference path so both answer exactly the same shape.
  function infoFrom (s, map) {
    return {
      ok: s.ok,
      user: s.user || iap._user,
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
  }

  // ── the entitlement resolution ladder ───────────────────────────────────
  //
  // THE INVARIANT. Every read of entitlement truth, on every runtime, goes
  // through resolveEntitlement() below. Sources are listed in precedence
  // order and each one answers with exactly one of POSITIVE, NEGATIVE, EMPTY
  // or ERROR:
  //
  //   1. EMPTY is not NEGATIVE. A source that answered without carrying any
  //      entitlement state (a bare `{}` ack from a build that implements the
  //      action but not the payload) never terminates resolution.
  //   2. ERROR is not NEGATIVE. On the client, an errored source is skipped
  //      and resolution continues down the ladder. (The /server helpers
  //      throw instead, so backend gates fail closed — see server.cjs.)
  //   3. A NEGATIVE from a higher-precedence source does not override a
  //      POSITIVE from a lower one. Confirming before denying is the rule at
  //      every rung, not a special case of any one API version.
  //   4. Only a NEGATIVE that no lower source contradicts denies.
  //   5. Metadata from a source that did not decide still rides along on the
  //      answer (subscriptions, the manage deep link, the identity it named).
  //
  // Rules 1 and 3 are the ones that matter: "a paying subscriber reads as not
  // entitled" is what happens when an empty-but-authoritative-looking answer
  // is allowed to outrank a truer answer from a lower-precedence source, and
  // it is the same defect wherever it appears in the ladder. Adding a source
  // means adding a rung to the array — never adding a branch.
  var POSITIVE = 'positive'   // reports at least one ACTIVE entitlement
  var NEGATIVE = 'negative'   // reports entitlement state, and none is active
  var EMPTY = 'empty'         // answered, but carries no entitlement state
  var ERROR = 'error'         // did not answer (threw, timed out, absent)

  // How a customer envelope classifies. `details` with content and any
  // active/all rows both count as "this build reported real state"; an empty
  // object is a bare ack and must not outrank anything.
  function classifyEnvelope (envelope) {
    if (!envelope) return ERROR
    var ents = envelope.entitlements
    if (ents && (ents.active || []).length) return POSITIVE
    var details = envelope.details
    if (details && Object.keys(details).length) {
      // A details map is real state. It is POSITIVE only if some entitlement
      // in it is actually active — otherwise this build is telling us the
      // customer has none, which is NEGATIVE, not EMPTY.
      for (var k in details) {
        if (details[k] && details[k].active) return POSITIVE
      }
      return NEGATIVE
    }
    if (ents && (ents.all || []).length) return NEGATIVE
    return EMPTY
  }

  function classifyEntitlements (ents) {
    if (!ents) return ERROR
    if ((ents.active || []).length) return POSITIVE
    if ((ents.all || []).length) return NEGATIVE
    return EMPTY
  }

  // An already-reduced status object (restore() returns one). Same three-way
  // rule as every other source, in one place.
  function classifyStatus (s) {
    if (!s) return ERROR
    if (s.active && s.active.length) return POSITIVE
    return s.all && s.all.length ? NEGATIVE : EMPTY
  }

  // Classified through historyStatus itself, so "which rows count as active"
  // has exactly one definition rather than a second copy that can drift.
  function classifyHistory (rows) {
    if (!rows) return ERROR
    if (!Array.isArray(rows) || !rows.length) return EMPTY
    var s = historyStatus(rows)
    if (s.active.length) return POSITIVE
    return s.all.length ? NEGATIVE : EMPTY
  }

  // Retained as the "did this source report anything at all" predicate that
  // callers outside the ladder (info(), the V3 path) still ask for.
  function reportsEntitlements (envelope) {
    var k = classifyEnvelope(envelope)
    return k === POSITIVE || k === NEGATIVE
  }

  // The whole decision, in one place. `rungs` is in precedence order; each is
  // { kind, status } where status is a thunk producing the status object.
  //
  // Any POSITIVE anywhere in the ladder makes the answer POSITIVE (rule 3),
  // and the highest-precedence POSITIVE supplies the shape because it is the
  // most authoritative source that agrees. Only when no rung is POSITIVE may
  // a NEGATIVE decide (rule 4), and only then does EMPTY get to answer at
  // all (rule 1). Metadata from the top envelope rides along regardless
  // (rule 5).
  function resolveEntitlement (rungs, fallback) {
    var best = null
    var i
    for (i = 0; i < rungs.length; i++) {
      if (rungs[i].kind === POSITIVE) { best = rungs[i]; break }
    }
    if (!best) {
      for (i = 0; i < rungs.length; i++) {
        if (rungs[i].kind === NEGATIVE) { best = rungs[i]; break }
      }
    }
    if (!best) {
      for (i = 0; i < rungs.length; i++) {
        if (rungs[i].kind === EMPTY) { best = rungs[i]; break }
      }
    }
    if (!best) return fallback()
    return best.status()
  }

  // When the entitlement answer comes from history/the entitlements read but
  // a real customer envelope also arrived, keep the envelope's metadata
  // (active subscriptions, the manage deep link, the identity it named):
  // falling back for entitlements must not blank fields the envelope carried.
  function withEnvelopeMeta (status, envelope) {
    if (!envelope) return status
    keepProject(envelope)
    if (Array.isArray(envelope.subscriptions) && envelope.subscriptions.length && !status.subscriptions.length) {
      status.subscriptions = envelope.subscriptions
    }
    if (envelope.management && !status.management) status.management = envelope.management
    if (envelope.user && !status.user) {
      status.user = envelope.user
      status.anonymous = envelope.anonymous !== false
    }
    return status
  }

  function customerStatus (envelope, rows) {
    var ents = envelope && envelope.entitlements || {}
    keepProject(envelope)
    var active = ents.active || []
    var all = ents.all || []
    // classifyEnvelope() reads the `details` map, so this must read it too. A
    // build that reports per-entitlement detail WITHOUT the entitlements
    // summary is a real, granting answer; deriving active[] only from the
    // summary would let that rung win the ladder and then report nothing —
    // a paying subscriber denied by the very resolver meant to prevent it.
    var details = envelope && envelope.details
    if (details && !active.length) {
      var derivedActive = []
      var derivedAll = []
      for (var k in details) {
        if (!details[k]) continue
        if (derivedAll.indexOf(k) === -1) derivedAll.push(k)
        if (details[k].active && derivedActive.indexOf(k) === -1) derivedActive.push(k)
      }
      if (derivedActive.length) active = derivedActive
      if (!all.length && derivedAll.length) all = derivedAll
    }
    return {
      ok: envelope.ok !== false,
      active: active,
      all: all,
      subscriptions: envelope.subscriptions || [],
      purchases: Array.isArray(rows) ? rows : [],
      user: envelope.user || iap._user,
      anonymous: envelope.anonymous !== false,
      management: envelope.management || null,
      // Per-entitlement lifecycle state, when the build reports it. Carried
      // through untouched so info() can read real state instead of inferring
      // it from store history. Null on builds that predate it.
      details: envelope.details || null,
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
    // null stays null: the legacy V3 offerings channel reports no numeric
    // intro price, and "unknown" must not render as "$0.00".
    return { value: value == null ? null : value, text: text || '', currency: currency || null }
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
        // The envelope's own payment mode wins when it carries one. Otherwise
        // the heuristic: pay-as-you-go bills the intro price for multiple
        // cycles, pay-up-front once.
        type: intro.mode === 'payg' || intro.mode === 'upfront' ? intro.mode
          : intro.cycles > 1 ? 'payg' : 'upfront',
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

  // plans() describes ONE offering: the filtered one when a filter was
  // applied, otherwise the current one. Flattening every offering in the
  // project lets a non-current offering (an experiment, a win-back, a legacy
  // price) claim the canonical short id like 'monthly' and hand it to buy(),
  // charging the wrong SKU at the wrong price. Falls back to the flat product
  // list when the envelope carries no offering structure (legacy channels).
  function planSource (envelope) {
    var offerings = envelope && envelope.offerings || []
    var scope = null
    if (offerings.length === 1) {
      scope = offerings[0]
    } else if (offerings.length > 1) {
      for (var i = 0; i < offerings.length; i++) {
        var o = offerings[i] || {}
        if (o.current === true || (envelope.current && o.id === envelope.current)) { scope = o; break }
      }
    }
    var rows = scope && scope.packages ? scope.packages.map(function (p) { return p && p.product }).filter(Boolean) : []
    return rows.length ? rows : (envelope && envelope.products || [])
  }

  function buildPlans (envelope) {
    var products = planSource(envelope)
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

  // Internal timeout table (ms), read at call time. Not part of the public
  // API: it exists so the test suite can shrink the long native waits.
  var T = {
    read: 8000,        // identity / customer / entitlements reads
    catalog: 15000,    // unified products read
    offerings: 10000,  // legacy V3 offerings channel
    history: 15000,    // store purchase history
    probe: 20000,      // paywall / Customer Center presentation acks
    purchase: 600000,  // a store purchase sheet can sit open for minutes
    sheet: 1800000     // paywall / Customer Center outcome window
  }

  var iap = {

    debug: false,

    _t: T,

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
      if (id && anon === false && !self._user) {
        self._user = id
        // Adoption is an identity change like any other: a catalog cached for
        // the anonymous user must not price the adopted account.
        self._catalogs = {}
        self._scope = ''
      }
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
          return v4call('whoami', {}, T.read).then(function (d) {
            return self._identity(d && d.app_user_id, !!(d && d.is_anonymous))
          }).catch(function () { return self._identity(null, void 0) })
        }
        if (rt === 3 && self._bridge >= 2) {
          // Only fire the scheme once an envelope has stamped bridge >= 2:
          // older builds route unknown revenuecat:// actions into the
          // purchase catch-all, which must never happen for a read.
          return chained('user', function () {
            // Register the response channel BEFORE firing: awaitChannel clears
            // the window variable on setup, so a synchronously-answering
            // native layer must never beat the listener.
            var wait = awaitChannel('revenueCatUser', 'onRevenueCatUser', T.read)
            fire('revenuecat://whoami')
            return wait
          }).then(function (envelope) {
            if (!envelope) return self._identity(null, void 0)
            keepProject(envelope)
            return self._identity(envelope.user, envelope.anonymous !== false)
          })
        }
        return Promise.resolve(self._identity(null, void 0))
      }
      var next = id == null || id === '' ? null : String(id)
      // Targeted offerings / placements can price users differently: a cached
      // catalog must never survive an identity change.
      if (next !== self._user) { self._catalogs = {}; self._scope = '' }
      self._user = next
      self._v3bound = false
      if (self._user && runtime() === 4) {
        // Forward-compatible session bind, fire-and-forget: newer builds carry
        // a native login action that merges anonymous history immediately;
        // older builds reject/timeout silently and we stay in per-call
        // identity mode (still correctly attributed). Never block app boot on
        // the probe.
        v4call('login', { external_id: self._user }, T.read).catch(function () {})
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

    // Who does RevenueCat think this device is, right now?
    //
    //   const me = await revenuecat.whoami()
    //   // { id, user, anonymous, registered, source }
    //
    // Identical to user() with no arguments, named for the question it
    // answers. Reads the NATIVE SDK's opinion rather than this package's local
    // state, which is the distinction that matters after a migration: the
    // RevenueCat SDK persists its identity across app restarts, so a device
    // can already be logged in as someone before your JavaScript says a word.
    //
    //   anonymous: true   RevenueCat minted its own id ($RCAnonymousID:…).
    //                     Purchases attach to the DEVICE, not an account.
    //   registered: true  An id you supplied via user(id) is in force.
    //
    // `source` says where the answer came from, so "we could not ask" is
    // never mistaken for "the user is anonymous":
    //   'native' the SDK answered · 'local' this build has no identity read,
    //   so the answer is this package's own state · 'web' not in an app.
    //
    // The migration case (anonymous → registered) is handled by user(newId),
    // which calls the native login and merges the anonymous purchase history
    // into the account. Call whoami() after it to confirm the merge landed
    // rather than assuming it did.
    whoami: function () {
      var self = this
      var rt = runtime()
      if (rt === 0) {
        return Promise.resolve({ id: null, user: null, anonymous: true, registered: false, source: 'web' })
      }
      var canRead = rt === 4 || (rt === 3 && self._bridge >= 2)
      return self.user().then(function (who) {
        who.source = canRead ? 'native' : 'local'
        return who
      })
    },

    // Clear the current identity. On newer builds this also rotates the
    // native RevenueCat user to a fresh anonymous id; on older builds the
    // package simply stops sending the id, apps with accounts should gate on
    // their own auth state too:
    //   const premium = user && await revenuecat.has('premium')
    logout: function () {
      this._user = null
      this._catalogs = {}
      this._scope = ''
      this._v3bound = false
      if (runtime() === 4) {
        // Fire-and-forget: newer builds rotate the native RevenueCat user to
        // a fresh anonymous id; older builds ignore it. The local clear above
        // is what stops this package from sending the old id either way.
        v4call('logout', {}, T.read).catch(function () {})
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

    // Remember the last good catalog PER OFFERING SCOPE so buy('monthly') can
    // resolve plan ids without another native roundtrip. Scoped, not a single
    // slot: a short id like 'monthly' means a different product in different
    // offerings, so an unrelated catalog read (a prefetch, another screen)
    // must not silently repoint the id the user is about to buy at a
    // different SKU and a different price.
    _cache: function (envelope, scope) {
      if (envelope && (envelope.ok !== false || (envelope.products && envelope.products.length))) {
        this._catalogs[scope || ''] = { envelope: envelope, plans: buildPlans(envelope) }
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
        return v4call('catalog', { external_id: self._user, offering: offering }, T.read)
          .then(keepProject)
          .catch(function (err) {
            // Older V4 build without `catalog`. Try `offerings` next, which
            // still carries offering and package placement, and only then the
            // flat `products` action.
            warn('catalog unavailable (' + (err && err.code) + '), falling back to offerings()')
            return v4call('offerings', {}, T.read).then(function (data) {
              var envelope = mapV4Offerings(data)
              if (!envelope.products.length) throw { code: 'empty' }
              return envelope
            }).catch(function () {
              return v4call('products', {}, T.read).then(function (rows) {
                var products = (Array.isArray(rows) ? rows : []).map(mapV4Product)
                return { ok: true, current: null, offerings: [], products: products, platform: os(), runtime: 4, user: self._user, project: self.project, error: null, code: null }
              }).catch(function (e2) {
                return { ok: false, current: null, offerings: [], products: [], platform: os(), runtime: 4, user: self._user, project: self.project, error: e2 && e2.message || 'catalog failed', code: e2 && e2.code || 'error' }
              })
            })
          })
          .then(function (envelope) {
            // The fallback reads ignore the filter, so apply it here. It must
            // never widen: a request for one offering that matches nothing
            // answers not-found, exactly like the native catalog action, and
            // never the whole catalog (which would price a user off the wrong
            // offering). A native not-found envelope is left alone.
            if (offering && envelope && envelope.ok !== false && envelope.offerings) {
              var kept = envelope.offerings.filter(function (o) { return o.id === offering })
              envelope.offerings = kept
              envelope.products = kept.length ? kept[0].packages.map(function (p) { return p.product }) : []
              if (!kept.length) {
                envelope.ok = false
                envelope.error = 'No offering found for ' + offering + '.'
                envelope.code = 'offeringNotFoundError'
              }
            }
            return self._cache(envelope, offering)
          })
      }
      return chained('products', function () {
        var cmd = 'revenuecat://products'
        var q = []
        if (self._user) q.push('external_id=' + encodeURIComponent(self._user))
        if (offering) q.push('offering=' + encodeURIComponent(offering))
        if (q.length) cmd += '?' + q.join('&')
        var wait = awaitChannel('revenueCatProducts', 'onRevenueCatProducts', T.catalog)
        fire(cmd)
        return wait
      }).then(function (envelope) {
        if (envelope) return keepProject(envelope)
        // Older classic build without the unified products read. The legacy
        // offerings channel predates it and answers a different shape, so a
        // paywall can still be rendered on those binaries.
        warn('products query timed out, trying the legacy offerings read (rebuild in Despia for the full catalog API)')
        return self._v3Offerings(offering)
      }).then(function (envelope) { return self._cache(envelope, offering) })
    },

    // The legacy classic-runtime catalog read. Answers on window.offeringsData
    // with window.offeringsError, and its callback takes no argument, so the
    // data is read off the window either way.
    _v3Offerings: function (offering) {
      var self = this
      return chained('offerings', function () {
        try { if (W) { delete W.offeringsError } } catch (e) {}
        var wait = awaitChannel('offeringsData', 'onRevenueCatOfferings', T.offerings)
        fire('revenuecat://offerings' + (offering ? '?offering=' + encodeURIComponent(offering) : ''))
        return wait
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
      var scope = offering || ''
      return this.offers(offering).then(function (envelope) {
        // plans() is the paywall-rendering call, so it decides which scope a
        // later bare buy('monthly') refers to. Catalog READS (products/offers)
        // deliberately do not move it: the user buys what they were shown.
        self._scope = scope
        var hit = self._catalogs[scope]
        if (hit && hit.envelope === envelope) return hit.plans
        return buildPlans(envelope)
      })
    },

    // scope -> { envelope, plans }
    _catalogs: {},
    // The offering scope plans() last rendered.
    _scope: '',

    // The snapshot a bare buy() resolves against.
    get _catalog () { return this._catalogs[this._scope] || null },

    // Resolve a buy() argument, plan id ('monthly'), kind, '$rc_' package id,
    // or store product id, to the underlying store product id.
    _resolve: function (x) {
      var self = this
      var s = String(x && x.product || x)     // accept a whole plan object too
      var hit = findPlan(self._catalog && self._catalog.plans, s)
      if (!hit) {
        // Not in the rendered scope: fall back to any other cached snapshot
        // rather than sending an unresolved short id to the store.
        for (var k in self._catalogs) {
          if (k === self._scope) continue
          hit = findPlan(self._catalogs[k] && self._catalogs[k].plans, s)
          if (hit) break
        }
      }
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
      // Accept a plan/product id (string) or a whole plan object; anything
      // else must fail here, not reach the store as "[object Object]".
      var pid = product && typeof product === 'object' ? product.product : product
      if (pid == null || pid === '' || (typeof pid !== 'string' && typeof pid !== 'number')) {
        return Promise.resolve(rejection({ code: 'missing_param', message: 'buy(product) needs a product or plan id.' }, 'purchase'))
      }
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
          return v4call('purchase', args, T.purchase)
            .catch(function (err) {
              if (self._user || !err || err.code !== 'missing_param') throw err
              var legacy = { external_id: self._anon(), product: productId }
              if (offer) legacy.offer = offer
              return v4call('purchase', legacy, T.purchase)
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
          var wait = awaitChannel('revenueCatResult', 'onRevenueCatResult', T.purchase, function (r) {
            return r && r.source === 'purchase'
          })
          fire('revenuecat://purchase?' + parts.join('&'))
          return wait
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
      // An offering id that does not exist must not quietly become the default
      // offering. plans('typo') already answers offeringNotFoundError; the
      // native paywall falls back instead, so `paywall('black-friday')` with a
      // misspelled id charges full price while the caller believes a promo is
      // on screen. Same class as render/charge identity: what was asked for and
      // what the user is charged from have to be the same offering.
      //
      // Verified-missing refuses. Unverifiable (the catalog read itself failed)
      // still presents — a flaky read must not cost every sale — so this closes
      // the typo case, which is the one that actually happens, without making
      // the paywall depend on a second network call succeeding.
      if (offering) {
        return self._assertOffering(offering).then(function (missing) {
          if (missing) return missing
          return self._presentPaywall(offering)
        })
      }
      return self._presentPaywall(offering)
    },

    // Resolves to a rejection result when the offering is known not to exist,
    // or null when it exists / cannot be checked.
    _assertOffering: function (offering) {
      var self = this
      // Every field Result declares. Omitting product/transaction/entitlements/
      // user would type-check against index.d.ts and then throw at runtime the
      // first time a caller read r.entitlements on a refused paywall.
      function refusal () {
        return {
          ok: false, cancelled: false, restored: false, source: 'paywall',
          product: null, transaction: null, entitlements: [], user: self._user,
          platform: os(), runtime: runtime(),
          error: 'No offering found for ' + offering + '.',
          code: 'offeringNotFoundError'
        }
      }
      // A cached catalog is evidence only if it actually lists offerings. A
      // build whose catalog read degraded to the flat product list reports
      // none, which proves nothing either way — fall through and let the
      // authoritative read answer rather than guessing from it.
      function lists (envelope) {
        var l = envelope && envelope.offerings
        if (!l || !l.length) return null                  // no evidence
        for (var i = 0; i < l.length; i++) {
          if (!l[i]) continue
          if (String(l[i].id) === String(offering)) return true
          // The legacy V3 offerings channel cannot name what it returned and
          // labels its single offering `id: ''` even when the native side
          // honored the filter. An unlabelled entry proves nothing about a
          // named offering, so this is no evidence rather than absence —
          // otherwise paywall() refuses EVERY named offering on classic
          // builds and the sale is simply lost.
          if (!l[i].id) return null
        }
        return false
      }
      var known = self._catalogs[offering] || self._catalogs['']
      var cached = known && lists(known.envelope)
      if (cached === true) return Promise.resolve(null)
      if (cached === false) return Promise.resolve(refusal())
      // Bounded. offers() can burn the catalog budget and then the offerings
      // budget before answering, which on a silent channel is ~25s of nothing
      // after the user tapped Upgrade. An unverified offering already presents
      // by policy, so time out into presenting rather than into a stall.
      var timer
      var budget = new Promise(function (resolve) {
        timer = setTimeout(function () { resolve(null) }, T.probe)
        if (timer && timer.unref) timer.unref()
      })
      // No usable cache: ask. offers() already answers offeringNotFoundError
      // for an id that matches nothing, including on builds whose catalog read
      // cannot express offerings at all — so paywall() and plans() refuse the
      // same inputs. A read that throws outright leaves us unable to tell, and
      // there we present: a flaky catalog must not cost every sale.
      var check = self.offers(offering).then(function (envelope) {
        if (envelope && envelope.code === 'offeringNotFoundError') return refusal()
        return lists(envelope) === false ? refusal() : null
      }).catch(function () { return null })
      return Promise.race([check, budget]).then(function (r) {
        clearTimeout(timer)
        return r
      })
    },

    _presentPaywall: function (offering) {
      var self = this
      var rt = runtime()
      return chained('result', function () {
        return new Promise(function (resolve) {
          var done = false
          var wait = awaitChannel('revenueCatResult', 'onRevenueCatResult', T.sheet, function (r) {
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
            v4call('paywall', args, T.probe)
              .catch(function (err) {
                // A build that predates the `paywall` spelling still carries
                // the legacy `launchPaywall` action.
                if (err && (err.code === 'no_module' || err.code === 'call_failed' || err.code === 'unknown_action')) {
                  return v4call('launchPaywall', args, T.probe)
                }
                throw err
              })
              .catch(function (err) {
                if (!self._user && err && err.code === 'missing_param') {
                  return v4call('paywall', { external_id: self._anon(), offering: offering }, T.probe)
                    .catch(function (e2) {
                      if (e2 && (e2.code === 'no_module' || e2.code === 'call_failed' || e2.code === 'unknown_action')) {
                        return v4call('launchPaywall', { external_id: self._anon(), offering: offering }, T.probe)
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
      // Same deferred gate as whoami/redeem: an unproven classic build routes
      // unknown revenuecat:// actions into its license-gated purchase
      // catch-all, which can raise a native alert. But answering unsupported
      // outright would break Customer Center on a perfectly capable build
      // whose app happens to open an account screen first, so prove the
      // bridge with the catalog read (an action every classic build has, and
      // one this package already fires unconditionally) and decide on facts.
      if (rt === 3 && !self._v3) {
        // The probe must never turn center() into a rejecting promise: the
        // client contract is that every call resolves.
        return self.offers().catch(function () { return null }).then(function () {
          if (!self._v3) {
            return { ok: false, source: 'center', platform: os(), runtime: 3, error: null, code: 'unsupported' }
          }
          return self._center(rt)
        })
      }
      return this._center(rt)
    },

    _center: function (rt) {
      var self = this
      return new Promise(function (resolve) {
        var done = false
        function settle (result) {
          if (done) return
          done = true
          stop()
          clearTimeout(cap)
          resolve(result)
        }
        var stop = hub('onRevenueCatCenter').add(function (event) {
          if (event && event.event === 'dismissed') {
            settle({ ok: true, source: 'center', platform: os(), runtime: rt, error: null, code: null })
          }
        })
        var cap = setTimeout(function () {
          settle({ ok: false, source: 'center', platform: os(), runtime: rt, error: 'No Customer Center result from the native layer.', code: 'timeout' })
        }, T.sheet)
        if (rt === 4) {
          v4call('center', { external_id: self._user }, T.probe).catch(function (err) {
            // Only an ack TIMEOUT is ambiguous: the sheet may well be on
            // screen on a build that answers at dismissal, so keep waiting
            // for the dismissed event (the outer cap still bounds it). Every
            // other rejection is terminal (not_ready, no_activity,
            // offerings_failed, no_module, ...) and must settle NOW rather
            // than holding the caller for the full sheet window.
            var code = err && err.code
            if (code === 'timeout') return
            settle({
              ok: false,
              source: 'center',
              platform: os(),
              runtime: 4,
              error: err && (err.message || err.error) || null,
              code: code === 'no_module' ? 'unsupported' : (code || 'error')
            })
          })
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
          v4call('customer', { external_id: self._user }, T.read).catch(function () { return null }),
          // Same budget restore() gives this read: a slow store history that
          // restore() tolerates must not make the gate answer "not entitled".
          v4call('history', {}, T.history).catch(function () { return null }),
          // The dedicated entitlements read, for builds that predate the
          // unified `customer` envelope: real RevenueCat entitlement state
          // beats inferring it from the device's store history.
          v4call('entitlements', {}, T.read).catch(function () { return null })
        ]).then(function (parts) {
          var envelope = parts[0]
          var rows = parts[1]
          var ents = parts[2]
          // The ladder, in precedence order. No branch decides anything here:
          // resolveEntitlement() applies the invariant, so a rung added later
          // cannot reintroduce "empty outranks true".
          return resolveEntitlement([
            {
              kind: classifyEnvelope(envelope),
              status: function () { return customerStatus(envelope, rows) }
            },
            {
              kind: classifyEntitlements(ents),
              status: function () { return withEnvelopeMeta(entitlementsStatus(ents, rows), envelope) }
            },
            {
              kind: classifyHistory(rows),
              status: function () { return withEnvelopeMeta(historyStatus(rows), envelope) }
            }
          ], function () {
            return emptyStatus('timeout', 'No response from the native layer.')
          })
        })
      }
      return chained('customer', function () {
        var wait = awaitChannel('revenueCatCustomer', 'onRevenueCatCustomer', T.read)
        fire(self._user ? 'revenuecat://customer?external_id=' + encodeURIComponent(self._user) : 'revenuecat://customer')
        return wait
      }).then(function (envelope) {
        if (envelope) {
          return self.restore().then(function (r) {
            // Same ladder, same invariant — restore() has already reduced the
            // store history to a status, so its rung classifies that.
            var rows = r && r.purchases || []
            return resolveEntitlement([
              {
                kind: classifyEnvelope(envelope),
                status: function () { return customerStatus(envelope, rows) }
              },
              {
                // classifyStatus, not an inline ternary: a fourth definition
                // of "is this positive" is exactly the branch the invariant
                // above forbids, and it would drift the moment what counts as
                // active changes.
                kind: classifyStatus(r),
                status: function () { return withEnvelopeMeta(r, envelope) }
              }
            ], function () {
              // Unreachable: rung 0 is inside `if (envelope)`, so it is never
              // ERROR and resolveEntitlement always has a rung to answer with.
              return customerStatus(envelope, rows)
            })
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
        return v4call('history', {}, T.history)
          .then(historyStatus)
          .catch(function (err) { return emptyStatus(err && err.code || 'error', err && err.message || null) })
      }
      return chained('history', function () {
        var wait = awaitChannel('restoredData', null, T.history)
        fire('getpurchasehistory://')
        return wait
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
        // Current builds report per-entitlement state natively, which is the
        // truth: it knows about renewals, cancellations still inside the paid
        // period, and billing retries, none of which the device's store
        // history can express. Older builds fall through to the inference
        // below, so nothing regresses.
        if (s.details) {
          for (var d in s.details) {
            var x = s.details[d] || {}
            map[d] = {
              active: !!x.active,
              product: x.product || null,
              period: x.period || null,
              bought: x.bought || null,
              expires: x.expires || null,
              renews: !!x.renews,
              // Set when the user turned auto-renew off but still has access:
              // the window where a win-back offer is worth showing.
              unsubscribed: x.unsubscribed || null,
              // Set while the store retries a failed payment (grace period).
              billingIssue: x.billingIssue || null,
              store: x.store || null,
              ownership: x.ownership || null,
              sandbox: !!x.sandbox
            }
          }
          return infoFrom(s, map)
        }
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
        return infoFrom(s, map)
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
        return v4call('redeem', {}, T.read)
          .then(function () { return { ok: true, supported: true, source: 'redeem', platform: os(), runtime: 4, error: null, code: null } })
          .catch(function () { return unsupported })
      }
      // Same deferred gate as the identity schemes: an unproven build routes
      // revenuecat://redeem into its license-gated catch-all, which can raise
      // a native alert. Only fire once an envelope has proven the bridge —
      // proving it with the catalog read when nothing else has run yet, since
      // a "Have a code?" button is often the first RevenueCat call an app
      // makes and answering unsupported outright would break it on a capable
      // build. (Same probe center() uses; offers() never rejects.)
      if (!self._v3) {
        return self.offers().catch(function () { return null }).then(function () {
          return self._v3 ? self._redeem(unsupported) : unsupported
        })
      }
      return this._redeem(unsupported)
    },

    _redeem: function (unsupported) {
      var self = this
      return chained('result', function () {
        // Newer builds ack presentation on the result channel; silence means
        // the build predates the redeem bridge.
        var wait = awaitChannel('revenueCatResult', 'onRevenueCatResult', T.read, function (r) {
          return r && r.source === 'redeem'
        })
        fire('revenuecat://redeem')
        return wait
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
      var list = (this._subs[event] = this._subs[event] || [])
      var entry = { fn: fn, remove: remove }
      list.push(entry)
      return function () {
        remove()
        var at = list.indexOf(entry)
        if (at !== -1) list.splice(at, 1)
      }
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
