// Type definitions for import 'base44-revenuecat/server': server-side
// RevenueCat subscriber verification for Base44 backend functions (Deno)
// and Node ESM. The declarations live with the CommonJS entry (server.d.cts);
// this entry re-exports them and adds the ESM default export.

export type { ServerOptions, ActiveEntitlement } from './server.cjs'
export { entitled, entitlements, customer } from './server.cjs'

import type { entitled, entitlements, customer } from './server.cjs'

declare const server: {
  entitled: typeof entitled
  entitlements: typeof entitlements
  customer: typeof customer
}
export default server
