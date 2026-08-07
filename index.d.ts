// Type definitions for base44-revenuecat — RevenueCat in-app purchases &
// subscriptions for Base44 apps built into native iOS / Android apps with Despia.

/** One product with live store pricing — identical JSON on iOS (StoreKit) and Android (Google Play Billing). */
export interface Product {
  /** Pass this straight to iap.buy(). iOS: the App Store product id. Android: "subId:basePlanId" for subscriptions. */
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
    price: number
    priceString: string
    period: string | null
    periodUnit: 'day' | 'week' | 'month' | 'year' | null
    periodCount: number | null
    cycles: number
    type: 'trial' | 'intro'
  } | null
  /** RevenueCat offering this product came from. */
  offering: string | null
  /** RevenueCat package identifier, e.g. "$rc_monthly". */
  package: string | null
  packageType: string | null
}

/** A RevenueCat offering with its packages. */
export interface Offering {
  id: string
  current: boolean
  packages: Array<{ id: string, type: string, product: Product }>
}

/** The full catalog envelope returned by iap.offers(). */
export interface Catalog {
  ok: boolean
  /** The current offering id configured in RevenueCat, or null. */
  current?: string | null
  offerings: Offering[]
  /** Flat, de-duplicated product list — what iap.products() returns. */
  products: Product[]
  platform: 'ios' | 'android' | 'web'
  /** 4 = Despia Framework, 3 = classic Despia runtime, 0 = browser. */
  runtime: number
  user?: string | null
  /** RevenueCat project id when configured in Despia > Integrations. */
  project?: string | null
  error: string | null
  code: string | null
}

/** Outcome of iap.buy() / iap.paywall() — resolves, never rejects. */
export interface Result {
  ok: boolean
  /** true when the user closed the sheet / paywall without buying. */
  cancelled: boolean
  /** true when the outcome was a restore rather than a new purchase. */
  restored?: boolean
  source: 'purchase' | 'paywall' | 'center' | string
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

/** Entitlement + purchase snapshot returned by iap.status() / iap.restore(). */
export interface Status {
  ok: boolean
  /** Active entitlement ids — gate premium features on these. */
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
}

export interface Iap {
  /** Log verbose diagnostics to the console. */
  debug: boolean
  /** The RevenueCat app user id in use (set by login()). */
  user: string | null
  /** RevenueCat project id, auto-filled from the native layer when configured. */
  project: string | null
  /** true inside a Despia-built native app (V3 or V4). */
  readonly native: boolean
  readonly os: 'ios' | 'android' | 'web'
  /** 4 = Despia Framework, 3 = classic Despia runtime, 0 = browser. */
  readonly runtime: number

  /** Resolves environment info — handy on app start. */
  ready(): Promise<{ native: boolean, os: string, runtime: number, user: string | null, project: string | null }>

  /** Identify the user to RevenueCat. Use your Base44 user id so client and server always agree. */
  login(id: string): Promise<{ user: string | null }>
  logout(): Promise<{ user: null }>

  /** All products with live store pricing. Optionally filter by offering id. */
  products(offering?: string): Promise<Product[]>
  /** The full offerings/packages catalog envelope. */
  offers(offering?: string): Promise<Catalog>

  /** Native purchase for a product id from products(). */
  buy(product: string): Promise<Result>
  /** RevenueCat's native paywall (dashboard-designed). Resolves once per presentation. */
  paywall(offering?: string): Promise<Result>
  /** RevenueCat Customer Center (restore / manage / refunds). Resolves on close. */
  center(): Promise<{ ok: boolean, source: string, platform: string, runtime: number, error: string | null, code: string | null }>

  /** Entitlements + purchase snapshot. */
  status(): Promise<Status>
  /** Restore purchases (required by App Store review). Same shape as status(). */
  restore(): Promise<Status>
  /** The one-line client gate: active entitlement check. */
  has(entitlement: string): Promise<boolean>

  /** Subscribe to native events. Returns an unsubscribe function. */
  on(event: 'result', fn: (result: Result) => void): () => void
  on(event: 'purchase', fn: (customerInfo: unknown) => void): () => void
  on(event: 'center', fn: (event: { event: string, [key: string]: unknown }) => void): () => void
  off(event: 'result' | 'purchase' | 'center', fn?: (...args: never[]) => void): void
}

declare const iap: Iap
export default iap
