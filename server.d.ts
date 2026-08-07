// Type definitions for base44-revenuecat/server — server-side RevenueCat
// subscriber verification for Base44 backend functions (Deno) and Node.

export interface ServerOptions {
  /** RevenueCat SECRET API key (sk_...). Falls back to env RC_SECRET / REVENUECAT_SECRET_KEY. */
  secret?: string
  /** RevenueCat project id (proj...). Falls back to env RC_PROJECT / REVENUECAT_PROJECT_ID. Enables the v2 API path. */
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
