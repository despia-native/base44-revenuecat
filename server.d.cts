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
  /** Per-request timeout in milliseconds (default 10000). Numeric strings are accepted. The request is aborted and the error thrown when it elapses. */
  timeout?: number
  /**
   * Include sandbox purchases (sends RevenueCat's `X-Is-Sandbox` header).
   * RevenueCat returns PRODUCTION purchases only by default, so while testing
   * with a Sandbox Apple ID or a Play license tester the server would say
   * "not entitled" for a purchase the device can see. Falls back to env
   * RC_SANDBOX / REVENUECAT_SANDBOX. String values are parsed, not coerced:
   * "true"/"1"/"yes"/"on" enable it, anything else (including the string
   * "false") does not. Leave off in production — enabling it there hides
   * real purchases and denies every paying customer.
   *
   * Sandbox checks always use RevenueCat's v1 API, even when a secret key and
   * project id are configured: `X-Is-Sandbox` is a v1 header and v2 has no
   * documented sandbox support, so routing a tester through v2 would deny
   * every sandbox purchase. Production checks are unaffected.
   */
  sandbox?: boolean
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
 * @throws When no API key is configured, on RevenueCat non-2xx answers, and
 * on network errors/timeouts. Catch and deny (fail closed). The thrown Error
 * carries `status` (the HTTP status) and, on a 429, `retryAfter` in seconds
 * when RevenueCat sends a Retry-After header.
 * @example
 * const { entitled } = require('base44-revenuecat/server')
 * let ok = false
 * try { ok = await entitled(user.id, 'premium', { key: RC_KEY }) } catch (e) { ok = false }
 * if (!ok) return deny()
 */
export function entitled(user: string, entitlement: string, opts?: ServerOptions): Promise<boolean>

/**
 * All ACTIVE entitlements for a user. On the public-key (v1) path expiry is
 * enforced here against the current clock, counting a billing grace period as
 * still active. On the secret-key (v2) path RevenueCat's own
 * `active_entitlements` endpoint decides activity and its answer is taken as
 * authoritative.
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
