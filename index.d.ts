// Type definitions for base44-revenuecat: RevenueCat in-app purchases &
// subscriptions for Base44 apps built into native iOS / Android apps with Despia.


// The package's CommonJS export IS the revenuecat object itself (UMD:
// module.exports = iap, no .default property), so the declaration uses
// export= — accurate for require() — while ESM default imports still work
// (Node maps a CJS module.exports to the ESM default import).

declare namespace revenuecat {

  /**
   * Machine-readable failure reason carried by every envelope. Client calls
   * never reject — inspect `code` on the resolved value instead:
   * - 'web'                    not running inside a Despia app (browser/preview)
   * - 'no_module'              the RevenueCat module is excluded from this build
   * - 'unsupported'            this build does not carry the requested feature
   * - 'timeout'                the native layer did not answer in time
   * - 'call_failed'            the native call itself threw
   * - 'empty'                  the native layer answered with nothing
   * - 'missing_param'          a required argument was missing/invalid
   * - 'user_cancelled'         the user closed the store sheet without buying
   * - 'offeringNotFoundError'  no offering matched the requested id
   * Native layers may report additional store-specific codes verbatim.
   */
  export type ErrorCode =
    | 'web'
    | 'no_module'
    | 'unsupported'
    | 'timeout'
    | 'call_failed'
    | 'empty'
    | 'missing_param'
    | 'user_cancelled'
    | 'offeringNotFoundError'
    | (string & {})

  /** One product with live store pricing, identical JSON on iOS (StoreKit) and Android (Google Play Billing). */
  export interface Product {
    /** Pass this straight to buy(). iOS: the App Store product id. Android: "subId:basePlanId" for subscriptions. */
    id: string
    /** The raw store product id (Android: without the base-plan suffix). */
    sku: string
    /** Android base plan id; null on iOS and for one-time products. */
    plan: string | null
    type: 'subscription' | 'product'
    title: string
    desc: string
    /** Decimal price in the user's local currency. */
    price: number
    /** Localized price string straight from the store, e.g. "$9.99". */
    priceString: string
    currency: string | null
    /** ISO-8601 billing period, e.g. "P1M"; null for one-time products. */
    period: string | null
    periodUnit: 'day' | 'week' | 'month' | 'year' | null
    periodCount: number | null
    /** Free trial / introductory pricing, when the store offers one. */
    intro: {
      /** null when the build's channel reports only a display string. Render priceString. */
      price: number | null
      priceString: string
      period: string | null
      periodUnit: 'day' | 'week' | 'month' | 'year' | null
      periodCount: number | null
      /** null when the build does not report a cycle count. */
      cycles: number | null
      type: 'trial' | 'intro'
      /** The store's own payment mode, when the build reports it. Preferred over guessing from cycles. */
      mode?: 'trial' | 'payg' | 'upfront' | null
    } | null
    /** RevenueCat offering this product came from. */
    offering: string | null
    /** RevenueCat package identifier, e.g. "$rc_monthly". */
    package: string | null
    packageType: string | null
    /** Normalized store offers (filled by newer Despia builds). */
    offers?: PlanOffer[]
  }

  /** Nested money value, text is ALWAYS the display string, localized by the store. */
  export interface PlanPrice {
    /** Decimal amount. null = unknown (the legacy V3 channel reports only a display string for intro prices) — render `text`, never assume 0. */
    value: number | null
    text: string
    currency: string | null
  }

  export interface PlanPeriod {
    /** ISO-8601, e.g. "P1M". */
    iso: string | null
    value: number
    unit: 'day' | 'week' | 'month' | 'year' | string | null
  }

  /** A normalized store offer (introductory, promotional, or Google base-plan offer). */
  export interface PlanOffer {
    id: string
    type: 'trial' | 'intro' | 'promo' | string
    /** null = unknown on this build, the store enforces eligibility at purchase time. */
    eligible: boolean | null
    tags?: string[]
    price?: PlanPrice
    period?: PlanPeriod
    cycles?: number
    phases?: Array<{ type: string, price: PlanPrice, period: PlanPeriod, cycles?: number }>
  }

  /** A subscription plan shaped for rendering a paywall screen, from plans(). */
  export interface Plan {
    /** Stable short id, the packageType when unique ('monthly'), else derived. Feeds buy(). */
    id: string
    /** RevenueCat package identifier, e.g. "$rc_monthly". */
    rcId: string | null
    /** The underlying store product id. */
    product: string
    type: 'subscription' | 'product'
    kind: 'weekly' | 'monthly' | 'annual' | 'lifetime' | 'custom'
    title: string
    desc: string
    price: PlanPrice
    period: PlanPeriod | null
    /** Free trial, when the store offers one. eligible: null = the store decides at purchase. */
    trial: { days: number, eligible: boolean | null } | null
    /** Paid introductory offer (pay-as-you-go / pay-up-front), when present. */
    intro: {
      type: 'payg' | 'upfront'
      eligible: boolean | null
      price: PlanPrice
      period: PlanPeriod | null
      cycles: number
    } | null
    offers: PlanOffer[]
  }

  /** A RevenueCat offering with its packages. */
  export interface Offering {
    id: string
    current: boolean
    packages: Array<{ id: string, type: string, product: Product }>
  }

  /** The full catalog envelope returned by offers(). */
  export interface Catalog {
    ok: boolean
    /** The current offering id configured in RevenueCat, or null. */
    current?: string | null
    offerings: Offering[]
    /** Flat, de-duplicated product list, what products() returns. */
    products: Product[]
    platform: 'ios' | 'android' | 'web'
    /** 4 = Despia Framework, 3 = classic Despia runtime, 0 = browser. */
    runtime: number
    /** Native bridge capability version: 2 = whoami identity read + anonymous purchase fallback. Absent on older builds. */
    bridge?: number
    user?: string | null
    /** RevenueCat project id when configured in Despia > Integrations. */
    project?: string | null
    error: string | null
    code: ErrorCode | null
  }

  /** The current RevenueCat identity, resolved by user() / login() / logout(). */
  export interface Identity {
    /** The raw RevenueCat app user id, anonymous "$RCAnonymousID:..." ids included. Null only when unknown (plain browser / older build with nobody bound). */
    id: string | null
    /** The account id you bound with user(id), or one the native SDK persisted from a previous session. Null when anonymous. */
    user: string | null
    anonymous: boolean
    /** true when a real account id is bound, the direct "is this RevenueCat user registered/logged in?" check. */
    registered: boolean
  }

  /** Outcome of buy() / paywall(), resolves, never rejects. */
  export interface Result {
    ok: boolean
    /** true when the user closed the sheet / paywall without buying. */
    cancelled: boolean
    /** true when the outcome was a restore rather than a new purchase. */
    restored?: boolean
    source: 'purchase' | 'paywall' | 'center' | 'redeem' | string
    product: string | null
    transaction: string | null
    /** Active entitlement ids after the event, e.g. ["premium"]. */
    entitlements: string[]
    user: string | null
    platform: string
    runtime: number
    error: string | null
    code: ErrorCode | null
  }

  export interface BuyOptions {
    /**
     * A specific promotional / Google offer id to purchase with. Forwarded to
     * the native layer; honored on builds with explicit-offer support, ignored
     * (default offer logic) on older builds. Tag manual-only Google offers
     * `rc-ignore-offer` in RevenueCat so automatic selection skips them.
     */
    offer?: string
  }

  /** Entitlement + purchase snapshot returned by status() / restore(). */
  export interface Status {
    ok: boolean
    /** Active entitlement ids, gate premium features on these. */
    active: string[]
    /** Every entitlement id ever seen for this user. */
    all: string[]
    /** Active subscription product ids. */
    subscriptions: string[]
    /** Store purchase history rows (the classic restoredData shape). */
    purchases: PurchaseRow[]
    user: string | null
    anonymous: boolean
    /** Native subscription-management URL, when available. */
    management: string | null
    /** Raw per-entitlement lifecycle state from the native layer, when the build reports it. info() is the friendlier view over this. */
    details?: Record<string, EntitlementDetail> | null
    platform: string
    runtime: number
    error: string | null
    code: ErrorCode | null
  }

  /** Per-entitlement lifecycle state, reported natively by current builds. */
  export interface EntitlementDetail {
    active: boolean
    product: string | null
    /** What the user is paying right now. null on builds that do not report it; native layers may report further store-specific values. */
    period: 'normal' | 'trial' | 'intro' | 'promo' | 'prepaid' | (string & {}) | null
    bought: string | null
    expires: string | null
    /** false once the user turns auto-renew off, even while access continues. */
    renews: boolean
    /** When the user cancelled, while still inside the paid period. The window where a win-back offer is worth showing. Null otherwise, and on builds that predate lifecycle state. */
    unsubscribed?: string | null
    /** Set while the store is retrying a failed payment (grace period). Access usually continues meanwhile. */
    billingIssue?: string | null
    /** 'app_store' | 'play_store' | 'stripe' | 'promotional' | 'amazon' | ... */
    store?: string | null
    /** 'purchased' | 'family_shared'. */
    ownership?: string | null
    sandbox?: boolean
  }

  /** Normalized full customer state from info(). */
  export interface Info {
    ok: boolean
    user: string | null
    anonymous: boolean
    active: string[]
    /** Per-entitlement lifecycle map, keyed by entitlement id (e.g. "premium"). */
    entitlements: Record<string, EntitlementDetail>
    subscriptions: string[]
    /** Native subscription-management URL, when available. */
    manage: string | null
    platform: string
    runtime: number
    error: string | null
    code: ErrorCode | null
  }

  /** One row of native store purchase history. */
  export interface PurchaseRow {
    transactionId: string | null
    originalTransactionId: string | null
    productId: string
    type: 'subscription' | 'product'
    /** The RevenueCat entitlement this purchase grants, e.g. "premium". */
    entitlementId: string | null
    isActive: boolean
    willRenew: boolean
    purchaseDate: string
    originalPurchaseDate: string
    expirationDate: string | null
    store: string
    country: string | null
    environment: string
    externalUserId?: string
    isAnonymous?: boolean
    provider?: string
    receipt?: string | null
    entitlement?: Record<string, unknown> | null
  }

  export interface RevenueCat {
    /** Log verbose diagnostics to the console. */
    debug: boolean
    /** The current RevenueCat app user id (null when anonymous). */
    readonly id: string | null
    /** RevenueCat project id, auto-filled from the native layer when configured. */
    project: string | null
    /** true inside a Despia-built native app (V3 or V4). */
    readonly native: boolean
    readonly os: 'ios' | 'android' | 'web'
    /** 4 = Despia Framework, 3 = classic Despia runtime, 0 = browser. */
    readonly runtime: number

    /** Resolves environment info, handy on app start. */
    ready(): Promise<{ native: boolean, os: string, runtime: number, user: string | null, project: string | null }>

    /**
     * Identify the user to RevenueCat, use your Base44 user's stable id so
     * client purchases and server checks always name the same customer.
     * Switching accounts is just another user(newId); user(null) clears the
     * identity. No argument resolves the current identity, read from the native
     * RevenueCat SDK on builds that support it: `id` is always the real
     * RevenueCat app user id (anonymous ids included) and `registered` answers
     * "is this user logged in?" directly.
     * @example await revenuecat.user(base44User.id)
     */
    user(id: string | null): Promise<Identity>
    user(): Promise<Identity>
    /** Alias of user(id). */
    login(id: string): Promise<Identity>
    /** Clear identity (also rotates to a fresh anonymous RevenueCat user on newer builds, fire-and-forget). */
    logout(): Promise<{ id: null, user: null, anonymous: true, registered: false }>

    /**
     * Subscription plans shaped for a paywall screen, with live store pricing.
     * @example const plans = await revenuecat.plans() // [{ id: 'monthly', price: { text: '$9.99' }, ... }]
     */
    plans(offering?: string): Promise<Plan[]>
    /** All products with live store pricing (flat unified shape). */
    products(offering?: string): Promise<Product[]>
    /** The full offerings/packages catalog envelope. */
    offers(offering?: string): Promise<Catalog>

    /**
     * Native purchase, accepts a plan id ('monthly'), a product id, or a plan
     * object. Resolves when the store sheet settles; never rejects.
     * @example const r = await revenuecat.buy('monthly'); if (r.ok) unlock()
     */
    buy(product: string | Plan, options?: BuyOptions): Promise<Result>
    /** RevenueCat's native paywall (dashboard-designed). Resolves once per presentation. */
    paywall(offering?: string): Promise<Result>
    /** RevenueCat Customer Center (restore / manage / refunds). Resolves on close. */
    center(): Promise<{ ok: boolean, source: string, platform: string, runtime: number, error: string | null, code: ErrorCode | null }>
    /** Apple offer-code redemption sheet (iOS). { supported: false } elsewhere / on older builds. */
    redeem(): Promise<{ ok: boolean, supported: boolean, source: string, platform: string, runtime: number, error: string | null, code: ErrorCode | null }>

    /**
     * The one-line client gate: active entitlement check. Each call re-asks the
     * native layer (a customer read, plus store history on classic builds), so
     * check once per screen and reuse the answer rather than calling per render.
     * @example if (await revenuecat.has('premium')) unlockPremium()
     */
    has(entitlement: string): Promise<boolean>
    /** Entitlements + purchase snapshot. */
    status(): Promise<Status>
    /** Normalized full customer state with a per-entitlement detail map. */
    info(): Promise<Info>
    /** Restore purchases (required by App Store review). Same shape as status(). */
    restore(): Promise<Status>

    /**
     * Subscribe to native events. Returns an unsubscribe function that also
     * releases this package's bookkeeping for the listener — call it (or use
     * off()) when a component unmounts.
     * @example const stop = revenuecat.on('purchase', refreshAccess); // later: stop()
     */
    on(event: 'result', fn: (result: Result) => void): () => void
    /** 'purchase' fires when the store confirms a transaction / customer info changes; the payload is the native customer-info envelope (shape varies by build — treat as advisory and re-read status()). */
    on(event: 'purchase', fn: (customerInfo: unknown) => void): () => void
    on(event: 'center', fn: (event: { event: string, [key: string]: unknown }) => void): () => void
    on(event: 'user', fn: (env: { ok: boolean, user: string | null, anonymous: boolean, registered?: boolean, bridge?: number, new?: boolean, entitlements?: { active: string[], all: string[] }, [key: string]: unknown }) => void): () => void
    /** Unsubscribe listener(s): with fn, removes that listener; without, removes every listener for the event. */
    off(event: 'result' | 'purchase' | 'center' | 'user', fn?: (...args: any[]) => void): void
  }

  /** @deprecated Use the RevenueCat interface name; kept for early adopters. */
    export type Iap = RevenueCat
}

declare const revenuecat: revenuecat.RevenueCat
export = revenuecat
export as namespace b44rc
