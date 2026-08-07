// Type definitions for base44-revenuecat/server — server-side RevenueCat
// subscriber verification for Base44 backend functions (Deno) and Node.

export interface ServerOptions {
  /**
   * Zero-secret auth: your RevenueCat PUBLIC SDK key (appl_... / goog_...).
   * RevenueCat's v1 subscriber endpoint accepts public keys for reads.
   * Configure it server-side (constant or env RC_KEY) — never read it from
   * the request. Falls back to env RC_KEY / REVENUECAT_PUBLIC_KEY.
   */
  key?: string
  /** RevenueCat SECRET API key (sk_...) — unlocks the v2 API path. Falls back to env RC_SECRET / REVENUECAT_SECRET_KEY. */
  secret?: string
  /** RevenueCat project id (proj...). Falls back to env RC_PROJECT / REVENUECAT_PROJECT_ID. Used with secret keys on the v2 path. */
  project?: string
}

export interface ActiveEntitlement {
  /** The entitlement lookup key you configured in RevenueCat, e.g. "premium". */
  id: string
  /** ISO expiry timestamp; null for lifetime entitlements. */
  expires: string | null
}

/** The one-line server gate: does this user have an active entitlement? */
export function entitled(user: string, entitlement: string, opts?: ServerOptions): Promise<boolean>

/** All active entitlements for a user. */
export function entitlements(user: string, opts?: ServerOptions): Promise<ActiveEntitlement[]>

/** Raw RevenueCat subscriber snapshot (v1 shape) for advanced use. */
export function customer(user: string, opts?: ServerOptions): Promise<Record<string, unknown> | null>

declare const server: {
  entitled: typeof entitled
  entitlements: typeof entitlements
  customer: typeof customer
}
export default server
