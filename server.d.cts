// Type definitions for require('base44-revenuecat/server'): server-side
// RevenueCat subscriber verification for Node backends (CommonJS entry).
// Note: the CommonJS entry has NO default export — use the named exports
// (or destructure the require result).

export interface ServerOptions {
  /**
   * Zero-secret auth: your RevenueCat PUBLIC SDK key (appl_... / goog_...).
   * RevenueCat's v1 subscriber endpoint accepts public keys. Note that the
   * v1 subscriber read is create-on-read: an id RevenueCat has never seen is
   * created as a customer (HTTP 200 or 201). Configure the key server-side
   * (constant or env RC_KEY), never read it from the request. Falls back to
   * env RC_KEY / REVENUECAT_PUBLIC_KEY.
   */
  key?: string
  /**
   * RevenueCat SECRET API key (sk_...), unlocks the v2 API path (project
   * scoping, documented rate limits). Wins over `key` when both are set.
   * Falls back to env RC_SECRET / REVENUECAT_SECRET_KEY.
   */
  secret?: string
  /**
   * RevenueCat project id (proj...). Falls back to env RC_PROJECT /
   * REVENUECAT_PROJECT_ID. Only used together with a secret (sk_...) key —
   * public keys always ride the v1 API.
   */
  project?: string
  /** Per-request timeout in milliseconds (default 10000). The request is aborted and the error thrown when it elapses. */
  timeout?: number
}

export interface ActiveEntitlement {
  /** The entitlement lookup key you configured in RevenueCat, e.g. "premium". */
  id: string
  /** ISO expiry timestamp; null for lifetime entitlements. */
  expires: string | null
}

/**
 * The one-line server gate: does this user have an active entitlement?
 *
 * @throws When no API key is configured, on RevenueCat non-2xx answers
 * (including 429 rate limits), and on network errors/timeouts. Catch and
 * deny (fail closed).
 * @example
 * const { entitled } = require('base44-revenuecat/server')
 * let ok = false
 * try { ok = await entitled(user.id, 'premium', { key: RC_KEY }) } catch (e) { ok = false }
 * if (!ok) return deny()
 */
export function entitled(user: string, entitlement: string, opts?: ServerOptions): Promise<boolean>

/**
 * All ACTIVE entitlements for a user (expiry enforced server-side).
 *
 * @throws Same conditions as {@link entitled}.
 * @example
 * const active = await entitlements(user.id, { key: RC_KEY })
 * // [{ id: 'premium', expires: '2026-09-01T00:00:00.000Z' }]
 */
export function entitlements(user: string, opts?: ServerOptions): Promise<ActiveEntitlement[]>

/**
 * Raw RevenueCat subscriber snapshot (v1 shape) for advanced use:
 * subscriptions, non_subscriptions, first_seen, management_url, etc.
 * Like every v1 subscriber read, this creates the customer if RevenueCat
 * has never seen the id. Resolves null only for a falsy user id.
 *
 * @throws Same conditions as {@link entitled}.
 */
export function customer(user: string, opts?: ServerOptions): Promise<Record<string, unknown> | null>
