// Fallback type declarations for consumers on moduleResolution "node"/"node10",
// which ignores the exports map and resolves 'base44-revenuecat/server' by
// file lookup. Consumers on node16/bundler resolution get server.d.mts /
// server.d.cts via the exports map instead. Named exports only: the CommonJS
// entry has no .default at runtime (default imports still work through
// esModuleInterop's synthetic default).

export interface ServerOptions {
  /**
   * Zero-secret auth: your RevenueCat PUBLIC SDK key (appl_... / goog_...).
   * Either platform's key works and ONE is enough: this check is scoped to
   * your RevenueCat project, not to a store, so an appl_ key also verifies
   * Google Play subscribers and a goog_ key also verifies App Store
   * subscribers. (Inside the app the rule is the opposite - there a key must
   * match the platform it runs on.)
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
   * REVENUECAT_PROJECT_ID. Only used together with a secret (sk_...) key -
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
   * "false") does not. Leave off in production - enabling it there hides
   * real purchases and denies every paying customer.
   *
   * Sandbox checks always use RevenueCat's v1 API, even when a secret key and
   * project id are configured: `X-Is-Sandbox` is a v1 header and v2 has no
   * documented sandbox support, so routing a tester through v2 would deny
   * every sandbox purchase. Production checks are unaffected.
   */
  sandbox?: boolean
  /**
   * On the secret-key (v2) path, confirm a "no entitlements" answer against
   * the v1 API before reporting it. Default true.
   *
   * v2's rules for grace periods and other still-granting states are
   * undocumented, and it has been observed returning nothing for a customer
   * v1 reports as entitled. Granting wrongly costs a little revenue; denying
   * a paying customer costs the customer - so a denial is verified. This
   * costs one extra request ONLY when v2 reports nothing for a customer it
   * knows; a positive answer and an unknown customer both cost nothing extra.
   * Set false if your traffic is mostly never-subscribed users and you would
   * rather take v2 at its word.
   */
  confirmDenials?: boolean

  /**
   * Cache a POSITIVE entitlement answer for this many milliseconds. Off by
   * default (`0`), and opt-in per call, e.g. `{ cacheMs: 30000 }`.
   *
   * Without it, an app that gates every request spends one RevenueCat request
   * per request and scales linearly into rate limiting - and a 429 throws,
   * which fail-closed handling turns into a 503 for a paying customer.
   *
   * Only grants are cached, never denials. Caching a grant briefly costs at
   * most a few seconds of access after a cancellation; caching a denial would
   * leave a customer who just subscribed locked out until the TTL expired.
   * Entries are keyed by credential, sandbox flag and user id, so two
   * projects - or a key rotation - never share an answer.
   */
  cacheMs?: number
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
 */
export function entitled(user: string, entitlement: string, opts?: ServerOptions): Promise<boolean>

/**
 * All ACTIVE entitlements for a user. On the public-key (v1) path expiry is
 * enforced here against the current clock, counting a billing grace period as
 * still active. On the secret-key (v2) path RevenueCat's own
 * `active_entitlements` endpoint decides activity - but a "nothing active"
 * answer for a customer it knows is confirmed against v1 before being
 * reported, so the two paths cannot disagree against a paying customer (see
 * `confirmDenials`).
 *
 * Resolves an **ARRAY** of `{ id, expires }` - not a keyed object. Calling
 * `Object.keys()` on it yields positions (`["0","1"]`), which fails quietly
 * because array indices are valid strings: the response looks structurally
 * fine while carrying positions where entitlement ids should be. If you only
 * need a gate, use {@link entitled} and there is no shape to handle at all.
 *
 * Not to be confused with {@link customer}, whose `.entitlements` field is
 * RevenueCat's raw keyed map. Different functions, different shapes.
 *
 * @example
 * const active = await entitlements(user.id, { key: RC_KEY })
 * // [{ id: 'premium', expires: '2026-08-11T16:30:46.000Z' },
 * //  { id: 'lifetime', expires: null }]
 *
 * active.map((e) => e.id)                    // ['premium', 'lifetime']
 * active.some((e) => e.id === 'premium')     // true
 * Object.keys(active)                        // ['0', '1']  <- positions, not ids
 *
 * @throws Same conditions as {@link entitled}.
 */
export function entitlements(user: string, opts?: ServerOptions): Promise<ActiveEntitlement[]>

/**
 * Raw RevenueCat subscriber snapshot (v1 shape) for advanced use. Like every
 * v1 subscriber read, this creates the customer if RevenueCat has never seen
 * the id. Resolves null for a falsy user id, and also if RevenueCat answers
 * 200 with no `subscriber` object.
 *
 * @throws Same conditions as {@link entitled}.
 */
export function customer(user: string, opts?: ServerOptions): Promise<Record<string, unknown> | null>
