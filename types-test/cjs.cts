// CommonJS consumer fixture: type-checked in CI (`tsc -p types-test`), never run.
import rcServer = require('base44-revenuecat/server')

async function main (): Promise<void> {
  const ok: boolean = await rcServer.entitled('u1', 'premium', { key: 'appl_x' })
  const active = await rcServer.entitlements('u1', { secret: 'sk_x', project: 'proj1', timeout: 5000 })
  // The CommonJS entry deliberately has NO default export (module.exports is
  // the named bag) — this must stay a type error:
  // @ts-expect-error the CJS server entry has no .default
  rcServer.default
  void [ok, active]
}
void main
