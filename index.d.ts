// Type definitions for base44-revenuecat: RevenueCat in-app purchases &
// subscriptions for Base44 apps built into native iOS / Android apps with Despia.

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
  value: number
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
  code: string | null
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
  code: string | null
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
  platform: string
  runtime: number
  error: string | null
  code: string | null
}

/** Normalized full customer state from info(). */
export interface Info {
  ok: boolean
  user: string | null
  anonymous: boolean
  active: string[]
  entitlements: Record<string, {
    active: boolean
    product: string | null
    /** 'normal' | 'trial' | 'intro' | 'promo' when the runtime reports it, else null. */
    period: string | null
    bought: string | null
    expires: string | null
    renews: boolean
  }>
  subscriptions: string[]
  /** Native subscription-management URL, when available. */
  manage: string | null
  platform: string
  runtime: number
  error: string | null
  code: string | null
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
   * Switching accounts is just another user(newId). No argument resolves the
   * current identity, read from the native RevenueCat SDK on builds that
   * support it: `id` is always the real RevenueCat app user id (anonymous ids
   * included) and `registered` answers "is this user logged in?" directly.
   */
  user(id: string): Promise<Identity>
  user(): Promise<Identity>
  /** Alias of user(id). */
  login(id: string): Promise<Identity>
  /** Clear identity (also rotates to a fresh anonymous RevenueCat user on newer builds, fire-and-forget). */
  logout(): Promise<Identity & { user: null, anonymous: true, registered: false }>

  /** Subscription plans shaped for a paywall screen, with live store pricing. */
  plans(offering?: string): Promise<Plan[]>
  /** All products with live store pricing (flat unified shape). */
  products(offering?: string): Promise<Product[]>
  /** The full offerings/packages catalog envelope. */
  offers(offering?: string): Promise<Catalog>

  /** Native purchase, accepts a plan id ('monthly'), a product id, or a plan object. */
  buy(product: string | Plan, options?: BuyOptions): Promise<Result>
  /** RevenueCat's native paywall (dashboard-designed). Resolves once per presentation. */
  paywall(offering?: string): Promise<Result>
  /** RevenueCat Customer Center (restore / manage / refunds). Resolves on close. */
  center(): Promise<{ ok: boolean, source: string, platform: string, runtime: number, error: string | null, code: string | null }>
  /** Apple offer-code redemption sheet (iOS). { supported: false } elsewhere / on older builds. */
  redeem(): Promise<{ ok: boolean, supported: boolean, source: string, platform: string, runtime: number, error: string | null, code: string | null }>

  /** The one-line client gate: active entitlement check. */
  has(entitlement: string): Promise<boolean>
  /** Entitlements + purchase snapshot. */
  status(): Promise<Status>
  /** Normalized full customer state with a per-entitlement detail map. */
  info(): Promise<Info>
  /** Restore purchases (required by App Store review). Same shape as status(). */
  restore(): Promise<Status>

  /** Subscribe to native events. Returns an unsubscribe function. */
  on(event: 'result', fn: (result: Result) => void): () => void
  on(event: 'purchase', fn: (customerInfo: unknown) => void): () => void
  on(event: 'center', fn: (event: { event: string, [key: string]: unknown }) => void): () => void
  on(event: 'user', fn: (env: { ok: boolean, user: string | null, anonymous: boolean, registered?: boolean, bridge?: number, new?: boolean, entitlements?: { active: string[], all: string[] }, [key: string]: unknown }) => void): () => void
  off(event: 'result' | 'purchase' | 'center' | 'user', fn?: (...args: never[]) => void): void
}

/** @deprecated Use the RevenueCat interface name; kept for early adopters. */
export type Iap = RevenueCat

declare const revenuecat: RevenueCat
export default revenuecat
