// base44-revenuecat/server: server-side subscriber verification for Base44
// backend functions (Deno) and any Node backend.
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
//     RevenueCat's v1 subscriber endpoint accepts public keys for reads, so
//     the only config is a value that is public by definition. Pass { key }
//     or set env RC_KEY. The key must be configured server-side (constant or
//     env), never read it from the request, or a caller could point the
//     check at a different RevenueCat app.
//   • SECRET: a RevenueCat secret key (sk_...) via { secret } / env RC_SECRET
//     unlocks the v2 API path (project-scoped, higher limits). Server-side
//     only, never ship it to the client.
// Configuration resolves in this order:
//   1. opts.secret / opts.key / opts.project
//   2. env RC_SECRET / RC_KEY / RC_PROJECT
//   3. env REVENUECAT_SECRET_KEY / REVENUECAT_PUBLIC_KEY / REVENUECAT_PROJECT_ID
//
// With a project id (the "Global project ID" from Despia > Your App >
// Integrations > RevenueCat) AND a secret key, the check uses RevenueCat's
// v2 API; otherwise, or if v2 is unavailable, it falls back to the v1
// subscribers API. Entitlements are always matched by their human lookup key
// ("premium"), on either path.

'use strict'

const V1 = 'https://api.revenuecat.com/v1'
const V2 = 'https://api.revenuecat.com/v2'

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
  // Only secret keys may use the v2 API; public keys always ride v1.
  return { secret: auth, project: auth.indexOf('sk_') === 0 ? project : null }
}

async function rcFetch (url, secret) {
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' } })
  return res
}

// v2 entitlement lookup-key join, cached ~5 minutes per project. The v2
// customer endpoint returns internal entitlement ids ("entl..."), so we map
// them back to the human lookup keys your app gates on.
const lookupCache = {}

async function v2LookupKeys (project, secret) {
  const cached = lookupCache[project]
  if (cached && cached.at > Date.now() - 300000) return cached.map
  const map = {}
  let url = `${V2}/projects/${encodeURIComponent(project)}/entitlements?limit=100`
  for (let page = 0; page < 10 && url; page++) {
    const res = await rcFetch(url, secret)
    if (!res.ok) throw new Error(`RevenueCat v2 entitlements ${res.status}`)
    const data = await res.json()
    for (const item of data.items || []) map[item.id] = item.lookup_key || item.id
    const next = data.next_page || null
    url = !next ? null
      : next.startsWith('http') ? next
        : 'https://api.revenuecat.com' + (next.startsWith('/') ? next : '/' + next)
  }
  lookupCache[project] = { at: Date.now(), map }
  return map
}

async function v2Entitlements (user, { project, secret }) {
  const id = encodeURIComponent(user)
  const res = await rcFetch(`${V2}/projects/${encodeURIComponent(project)}/customers/${id}/active_entitlements?limit=100`, secret)
  if (res.status === 404) return []                       // customer RevenueCat has never seen
  if (!res.ok) throw new Error(`RevenueCat v2 ${res.status}`)
  const data = await res.json()
  const items = data.items || []
  if (!items.length) return []
  const keys = await v2LookupKeys(project, secret)
  return items.map((e) => ({
    id: keys[e.entitlement_id] || e.entitlement_id,
    expires: e.expires_at ? new Date(e.expires_at).toISOString() : null
  }))
}

async function v1Entitlements (user, { secret }) {
  const id = encodeURIComponent(user)
  const res = await rcFetch(`${V1}/subscribers/${id}`, secret)
  if (!res.ok) throw new Error(`RevenueCat v1 ${res.status}`)
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
async function entitlements (user, opts) {
  if (!user) return []
  const c = creds(opts)
  if (c.project) {
    try {
      return await v2Entitlements(user, c)
    } catch (e) {
      // v2 key/endpoint mismatch, the v1 subscribers API answers for every key.
    }
  }
  return v1Entitlements(user, c)
}

// The one-line server gate: does this user have an active entitlement?
//   if (!await entitled(user.id, 'premium', { secret })) return deny()
async function entitled (user, entitlement, opts) {
  const active = await entitlements(user, opts)
  return active.some((e) => e.id === String(entitlement))
}

// Raw subscriber snapshot from RevenueCat (v1 shape) when you need more than
// the entitlement list: subscriptions, non-subscriptions, first_seen, etc.
async function customer (user, opts) {
  if (!user) return null
  const c = creds(opts)
  const res = await rcFetch(`${V1}/subscribers/${encodeURIComponent(user)}`, c.secret)
  if (!res.ok) throw new Error(`RevenueCat v1 ${res.status}`)
  const data = await res.json()
  return data.subscriber || null
}

module.exports = { entitled, entitlements, customer }
