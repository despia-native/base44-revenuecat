// base44-revenuecat/server: server-side subscriber verification for Base44
// backend functions (Deno) and any Node backend (Node 18+, needs global fetch).
//
// The client can show and hide screens on its own, but anything valuable:
// paid exports, credit top-ups, premium-only endpoints, must be verified
// where the user can't tamper with it. These helpers ask RevenueCat directly,
// so you need NO webhooks and NO subscription table:
//
//   import { entitled } from 'npm:base44-revenuecat/server'
//   const ok = await entitled(user.id, 'premium', { secret: secrets.get('RC_SECRET') })
//
// Auth, two options, lowest friction first:
//   • ZERO-SECRET: your RevenueCat PUBLIC SDK key (appl_... / goog_...).
//     RevenueCat's v1 subscriber endpoint accepts public keys, so the only
//     config is a value that already ships inside your app binary. Note that
//     GET /v1/subscribers is not a pure read: RevenueCat CREATES the customer
//     record if it has never seen the id (it answers 200 or 201), so every
//     distinct user id you check appears in your RevenueCat dashboard. The
//     check itself stays correct either way (a just-created customer has no
//     entitlements). Pass { key } or set env RC_KEY. The key must be
//     configured server-side (constant or env), never read it from the
//     request, or a caller could point the check at a different RevenueCat
//     app.
//   • SECRET: a RevenueCat secret key (sk_...) via { secret } / env RC_SECRET
//     unlocks the v2 API path (project-scoped, documented rate limits).
//     Server-side only, never ship it to the client.
// Configuration resolves in this order:
//   1. opts.secret / opts.key / opts.project
//   2. env RC_SECRET / RC_KEY / RC_PROJECT
//   3. env REVENUECAT_SECRET_KEY / REVENUECAT_PUBLIC_KEY / REVENUECAT_PROJECT_ID
// `secret` wins over `key` when both are set; which API path runs is decided
// by the key's own prefix (only sk_... keys may use v2), not by which option
// or variable carried it.
//
// Every function THROWS on failure: missing key, RevenueCat non-2xx answers
// (including 429 rate limits), and network errors/timeouts. Wrap calls in
// try/catch and fail closed (deny access) — see the README's server section.
//
// With a project id (the "Global project ID" from Despia > Your App >
// Integrations > RevenueCat) AND a secret key, the check uses RevenueCat's
// v2 API; if v2 turns out to be unavailable for that key or project (401/403/
// 404), it falls back to the v1 subscribers API, remembers the mismatch, and
// goes straight to v1 from then on. Entitlements are always matched by their
// human lookup key ("premium"), on either path.

'use strict'

const V1 = 'https://api.revenuecat.com/v1'
const V2 = 'https://api.revenuecat.com/v2'

const DEFAULT_TIMEOUT_MS = 10000

function env (name) {
  try {
    if (typeof process !== 'undefined' && process.env && process.env[name] != null) return process.env[name]
  } catch (e) {}
  try {
    if (typeof Deno !== 'undefined' && Deno.env && typeof Deno.env.get === 'function') {
      const v = Deno.env.get(name)
      if (v != null) return v
    }
  } catch (e) {}
  return undefined
}

function creds (opts) {
  opts = opts || {}
  const auth = opts.secret || opts.key ||
    env('RC_SECRET') || env('RC_KEY') ||
    env('REVENUECAT_SECRET_KEY') || env('REVENUECAT_PUBLIC_KEY')
  const project = opts.project || env('RC_PROJECT') || env('REVENUECAT_PROJECT_ID') || null
  if (!auth) {
    throw new Error('base44-revenuecat/server: missing RevenueCat API key. Pass { key } with your PUBLIC SDK key (appl_.../goog_...) or { secret } with a server-side sk_... key, or set RC_KEY / RC_SECRET (keys live at app.revenuecat.com -> Project settings -> API keys).')
  }
  const timeout = opts.timeout > 0 ? opts.timeout : DEFAULT_TIMEOUT_MS
  // Only secret keys may use the v2 API; public keys always ride v1.
  return { secret: auth, project: auth.indexOf('sk_') === 0 ? project : null, timeout }
}

async function rcFetch (url, c) {
  // A hung connection must not hang the caller's backend function: abort
  // after the timeout and let the error surface (fail closed).
  const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(c.timeout) : undefined
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + c.secret, 'Content-Type': 'application/json' }, signal })
  return res
}

function httpError (version, res) {
  const err = new Error(`RevenueCat ${version} ${res.status}` + (res.status === 429 ? ' (rate limited)' : ''))
  err.status = res.status
  return err
}

// v2 endpoints that answered 401/403/404 for a key+project are remembered so
// a misconfigured v2 setup doesn't double every request's latency forever.
const v2Broken = {}

// v2 entitlement lookup-key join, cached ~5 minutes per project. The v2
// customer endpoint returns internal entitlement ids ("entl..."), so we map
// them back to the human lookup keys your app gates on.
const lookupCache = {}

async function v2Page (start, c, onItems) {
  let url = start
  for (let page = 0; page < 10 && url; page++) {
    const res = await rcFetch(url, c)
    if (!res.ok) throw httpError('v2', res)
    const data = await res.json()
    onItems(data.items || [])
    const next = data.next_page || null
    url = !next ? null
      : next.startsWith('http') ? next
        : 'https://api.revenuecat.com' + (next.startsWith('/') ? next : '/' + next)
  }
}

async function v2LookupKeys (project, c, fresh) {
  const cached = lookupCache[project]
  if (!fresh && cached && cached.at > Date.now() - 300000) return cached.map
  const map = {}
  await v2Page(`${V2}/projects/${encodeURIComponent(project)}/entitlements?limit=100`, c, (items) => {
    for (const item of items) map[item.id] = item.lookup_key || item.id
  })
  lookupCache[project] = { at: Date.now(), map }
  return map
}

async function v2Entitlements (user, c) {
  const id = encodeURIComponent(user)
  const first = await rcFetch(`${V2}/projects/${encodeURIComponent(c.project)}/customers/${id}/active_entitlements?limit=100`, c)
  if (first.status === 404) {
    // Ambiguous: an unseen customer 404s, but so does a wrong project id —
    // and treating the latter as "no entitlements" would silently deny every
    // paying subscriber. Ask the project-scoped entitlements list (cached
    // ~5 minutes) to disambiguate: it answering proves the project id is
    // good, so the customer is simply unseen; it 404ing too throws, and the
    // caller falls back to v1 and remembers the broken project.
    await v2LookupKeys(c.project, c)
    return []
  }
  if (!first.ok) throw httpError('v2', first)
  const data = await first.json()
  const items = (data.items || []).slice()
  const next = data.next_page || null
  if (next) {
    await v2Page(next.startsWith('http') ? next : 'https://api.revenuecat.com' + (next.startsWith('/') ? next : '/' + next), c, (more) => {
      items.push(...more)
    })
  }
  if (!items.length) return []
  let keys = await v2LookupKeys(c.project, c)
  // An entitlement created after this project's map was cached would not be
  // in it, and returning the raw "entl..." id would read as a DIFFERENT
  // entitlement than the one the app gates on: a paying subscriber denied
  // until the cache expired. A miss refreshes the map once instead.
  if (items.some((e) => !keys[e.entitlement_id])) {
    keys = await v2LookupKeys(c.project, c, true)
  }
  return items.map((e) => ({
    id: keys[e.entitlement_id] || e.entitlement_id,
    // v2 reports expires_at as epoch milliseconds (per the API reference);
    // new Date() accepts that number directly, and an ISO string equally,
    // should the format ever change. null = lifetime.
    expires: e.expires_at ? new Date(e.expires_at).toISOString() : null
  }))
}

async function v1Entitlements (user, c) {
  const id = encodeURIComponent(user)
  const res = await rcFetch(`${V1}/subscribers/${id}`, c)
  if (!res.ok) throw httpError('v1', res)
  const data = await res.json()
  const ents = (data.subscriber && data.subscriber.entitlements) || {}
  const out = []
  for (const key of Object.keys(ents)) {
    const expires = ents[key].expires_date || null
    if (expires === null || Date.parse(expires) > Date.now()) {
      out.push({ id: key, expires: expires ? new Date(expires).toISOString() : null })
    }
  }
  return out
}

// All ACTIVE entitlements for a user, as [{ id: 'premium', expires: ISO|null }].
// `user` must be the same id the app passed to iap.login() / the paywall.
// Expiry is enforced here too (Date.parse against now), so a stale cache
// upstream can never extend access.
async function entitlements (user, opts) {
  if (!user) return []
  const c = creds(opts)
  const broken = c.secret + '|' + c.project
  if (c.project && !v2Broken[broken]) {
    try {
      return await v2Entitlements(user, c)
    } catch (e) {
      // Only a key/project mismatch means "v2 is not for this setup": fall
      // back to v1, which answers for every key, and remember the verdict.
      // Anything else (429 rate limit, 5xx, network failure, timeout) would
      // fail on v1 too — surface it instead of spending a second request.
      if (e && (e.status === 401 || e.status === 403 || e.status === 404)) {
        v2Broken[broken] = true
      } else {
        throw e
      }
    }
  }
  return v1Entitlements(user, c)
}

// The one-line server gate: does this user have an active entitlement?
//   if (!await entitled(user.id, 'premium', { secret })) return deny()
// Throws on configuration/network/API errors: catch and deny (fail closed).
async function entitled (user, entitlement, opts) {
  const active = await entitlements(user, opts)
  return active.some((e) => e.id === String(entitlement))
}

// Raw subscriber snapshot from RevenueCat (v1 shape) when you need more than
// the entitlement list: subscriptions, non-subscriptions, first_seen, etc.
// Like every v1 subscriber read, this creates the customer if RevenueCat has
// never seen the id.
async function customer (user, opts) {
  if (!user) return null
  const c = creds(opts)
  const res = await rcFetch(`${V1}/subscribers/${encodeURIComponent(user)}`, c)
  if (!res.ok) throw httpError('v1', res)
  const data = await res.json()
  return data.subscriber || null
}

module.exports = { entitled, entitlements, customer }
