// ESM consumer fixture: type-checked in CI (`tsc -p types-test`), never run.
// Uses the package's own name (self-reference via the exports map), so this
// exercises exactly what `import 'base44-revenuecat'` resolves for consumers.
import revenuecat from 'base44-revenuecat'
import type { Plan, Status, Info, ErrorCode } from 'base44-revenuecat'
import server, { entitled, entitlements, customer } from 'base44-revenuecat/server'
import type { ServerOptions, ActiveEntitlement } from 'base44-revenuecat/server'

async function main (): Promise<void> {
  await revenuecat.user('u1')
  await revenuecat.user(null)
  await revenuecat.user()
  const plans: Plan[] = await revenuecat.plans()
  const introValue: number | null = plans.length ? plans[0]!.price.value : null
  const r = await revenuecat.buy('monthly', { offer: 'promo' })
  const code: ErrorCode | null = r.code
  const s: Status = await revenuecat.status()
  const i: Info = await revenuecat.info()
  const period: string | null = i.entitlements['premium']?.period ?? null
  const stop = revenuecat.on('purchase', () => {})
  stop()
  revenuecat.off('purchase')

  const opts: ServerOptions = { key: 'appl_x', timeout: 5000 }
  const ok: boolean = await entitled('u1', 'premium', opts)
  const active: ActiveEntitlement[] = await entitlements('u1', { secret: 'sk_x', project: 'proj1' })
  const raw: Record<string, unknown> | null = await customer('u1', opts)
  const viaDefault: boolean = await server.entitled('u1', 'premium', opts)
  void [introValue, code, s, period, ok, active, raw, viaDefault]
}
void main
