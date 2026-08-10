// Legacy-resolution consumer fixture: moduleResolution "node10" ignores the
// exports map, so 'base44-revenuecat/server' must keep resolving via a
// sibling server.d.ts (regression: 1.6.0 briefly deleted it). Type-checked in
// CI, never run.
import revenuecat from 'base44-revenuecat'
import { entitled, entitlements, customer, ServerOptions, ActiveEntitlement } from 'base44-revenuecat/server'

async function main (): Promise<void> {
  await revenuecat.user('u1')
  const gate: boolean = await revenuecat.has('premium')
  const opts: ServerOptions = { key: 'appl_x', timeout: 5000 }
  const ok: boolean = await entitled('u1', 'premium', opts)
  const active: ActiveEntitlement[] = await entitlements('u1', { secret: 'sk_x', project: 'proj1' })
  const raw: Record<string, unknown> | null = await customer('u1', opts)
  void [gate, ok, active, raw]
}
void main
