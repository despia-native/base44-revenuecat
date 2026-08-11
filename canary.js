// Live canary: asserts this package's server helpers still agree with the real
// RevenueCat API. Run by .github/workflows/canary.yml on a schedule; see that
// file for the one-time dashboard setup and the repository secrets it needs.
//
// Why this exists: the rest of the suite simulates RevenueCat, so it proves the
// package does what we believe the API does and can never notice the API
// changing. Two behaviours it depends on - the X-Is-Sandbox header and v2's
// active_entitlements - are undocumented. Without this job, a silent change to
// either surfaces as a customer support ticket. With it, it is a red build.
//
// This makes no purchases and writes nothing. It reads fixed customers that
// were set up once by hand.
'use strict'

const { entitled, entitlements } = require('./server.cjs')

const CFG = {
  key: process.env.RC_CANARY_PUBLIC_KEY || '',
  secret: process.env.RC_CANARY_SECRET || '',
  project: process.env.RC_CANARY_PROJECT || '',
  entitlement: process.env.RC_CANARY_ENTITLEMENT || '',
  entitledId: process.env.RC_CANARY_ENTITLED_ID || '',
  deniedId: process.env.RC_CANARY_DENIED_ID || '',
  sandboxId: process.env.RC_CANARY_SANDBOX_ID || ''
}

const failures = []
const notes = []

async function check (label, run, expected) {
  let got
  try {
    got = await run()
  } catch (e) {
    failures.push(`${label}: threw ${e && e.status ? 'HTTP ' + e.status + ' ' : ''}${e && e.message}`)
    return
  }
  if (got === expected) {
    console.log(`  ok   ${label} → ${got}`)
  } else {
    failures.push(`${label}: expected ${expected}, got ${got}`)
    console.log(`  FAIL ${label} → ${got} (expected ${expected})`)
  }
}

async function main () {
  console.log('base44-revenuecat live canary')

  // A repo without the secrets (a fork, a fresh clone) is not broken - it is
  // unconfigured. Say so and succeed rather than reporting a false red.
  const required = ['key', 'entitlement', 'entitledId', 'deniedId']
  const missing = required.filter((k) => !CFG[k])
  if (missing.length) {
    console.log('\nnot configured - skipping. Missing: ' + missing.join(', '))
    console.log('See .github/workflows/canary.yml for the one-time setup.')
    return
  }

  const ENT = CFG.entitlement

  // ── the public-key path (v1) ────────────────────────────────────────────
  // This is the default in every doc, so it is the one that must keep working.
  console.log('\npublic key (v1):')
  await check('entitled customer is granted', () => entitled(CFG.entitledId, ENT, { key: CFG.key }), true)
  await check('unentitled customer is denied', () => entitled(CFG.deniedId, ENT, { key: CFG.key }), false)

  // A wrong entitlement id must not be granted to anyone. This catches a
  // matching change (e.g. internal ids leaking through instead of lookup keys)
  // that both assertions above would survive.
  await check(
    'an entitlement nobody has is denied',
    () => entitled(CFG.entitledId, ENT + '_canary_does_not_exist', { key: CFG.key }),
    false
  )

  // ── the secret-key path (v2, with the v1 confirmation) ──────────────────
  if (CFG.secret && CFG.project) {
    console.log('\nsecret key (v2):')
    // FIRST: prove the v2 path is actually reachable. server.cjs deliberately
    // falls back to v1 on a v2 401/403/404 and remembers it - and v1 accepts
    // sk_ keys, so every assertion below would answer correctly VIA V1 and the
    // canary would pass green for the exact drift it exists to catch. Ask v2
    // directly, outside the helpers, so a revoked or renamed v2 is a failure
    // rather than an invisible downgrade.
    try {
      const res = await fetch(
        `https://api.revenuecat.com/v2/projects/${encodeURIComponent(CFG.project)}/customers/${encodeURIComponent(CFG.entitledId)}`,
        { headers: { Authorization: 'Bearer ' + CFG.secret, 'Content-Type': 'application/json' } }
      )
      if (!res.ok) {
        failures.push(
          `v2 is not reachable for this key/project (HTTP ${res.status}). ` +
          'Every check below would silently answer via v1, so v2 drift would go unnoticed.'
        )
        console.log(`  FAIL v2 customer read → HTTP ${res.status}`)
      } else {
        const body = await res.json()
        if (!body || !Object.prototype.hasOwnProperty.call(body, 'active_entitlements')) {
          failures.push('v2 customer response no longer carries active_entitlements - the field this package reads.')
          console.log('  FAIL v2 response shape changed (no active_entitlements)')
        } else {
          console.log('  ok   v2 is reachable and still returns active_entitlements')
        }
      }
    } catch (e) {
      failures.push('v2 reachability probe threw: ' + (e && e.message))
    }
    await check(
      'entitled customer is granted on v2',
      () => entitled(CFG.entitledId, ENT, { secret: CFG.secret, project: CFG.project }),
      true
    )
    await check(
      'unentitled customer is denied on v2',
      () => entitled(CFG.deniedId, ENT, { secret: CFG.secret, project: CFG.project }),
      false
    )

    // THE ONE THAT MATTERS MOST. The two paths must agree about a paying
    // customer. If v2's undocumented rules drift, this is where it shows up
    // first - and the confirmation added in 1.6.1 is what keeps it true.
    try {
      const viaV1 = (await entitlements(CFG.entitledId, { key: CFG.key })).map((e) => e.id).sort()
      const viaV2 = (await entitlements(CFG.entitledId, { secret: CFG.secret, project: CFG.project })).map((e) => e.id).sort()
      if (JSON.stringify(viaV1) === JSON.stringify(viaV2)) {
        console.log(`  ok   v1 and v2 report the same entitlements → [${viaV1.join(', ')}]`)
      } else {
        failures.push(`v1/v2 disagree for the entitled customer: v1=[${viaV1}] v2=[${viaV2}]`)
        console.log(`  FAIL v1=[${viaV1}] v2=[${viaV2}]`)
      }
    } catch (e) {
      failures.push('v1/v2 comparison threw: ' + (e && e.message))
    }
  } else {
    notes.push('secret-key path skipped (RC_CANARY_SECRET / RC_CANARY_PROJECT unset)')
  }

  // ── sandbox ─────────────────────────────────────────────────────────────
  // X-Is-Sandbox is undocumented and the only way a tester's purchase is
  // visible to a server check. If it stops working, every customer's TestFlight
  // and internal-track testing silently reads as not entitled.
  if (CFG.sandboxId) {
    console.log('\nsandbox:')
    await check(
      'a sandbox purchase is visible with { sandbox: true }',
      () => entitled(CFG.sandboxId, ENT, { key: CFG.key, sandbox: true }),
      true
    )
    // And the production default must NOT see it, or { sandbox: true } means
    // nothing and testers would be indistinguishable from payers.
    await check(
      'and invisible without it',
      () => entitled(CFG.sandboxId, ENT, { key: CFG.key }),
      false
    )
  } else {
    notes.push('sandbox check skipped (RC_CANARY_SANDBOX_ID unset)')
  }

  // ── the cross-store claim ───────────────────────────────────────────────
  // The docs, the types and the error message all now tell people that ONE
  // public key of either platform verifies subscribers from both stores. If
  // that is ever wrong, someone who configured only an appl_ key silently
  // denies 100% of their Google Play subscribers with no error anywhere. Set
  // RC_CANARY_CROSS_STORE_ID to a customer whose purchase came from the OTHER
  // store than RC_CANARY_PUBLIC_KEY's platform to hold that claim to account.
  const crossId = process.env.RC_CANARY_CROSS_STORE_ID || ''
  if (crossId) {
    console.log('\ncross-store:')
    await check(
      'a subscriber from the OTHER store is verified by this key',
      () => entitled(crossId, ENT, { key: CFG.key }),
      true
    )
  } else {
    notes.push('cross-store check skipped (RC_CANARY_CROSS_STORE_ID unset) - the "either key verifies both stores" claim is documented but unverified')
  }

  console.log('')
  notes.forEach((n) => console.log('note: ' + n))
  if (failures.length) {
    console.error('\nCANARY FAILED - RevenueCat no longer behaves the way this package assumes:')
    failures.forEach((f) => console.error('  • ' + f))
    console.error('\nThis is not a flaky test. Read the failures above before releasing.')
    // exitCode, not exit(): console writes to a pipe (which is what Actions
    // gives this step) are async, and process.exit() drops whatever has not
    // flushed - discarding the only output this job produces.
    process.exitCode = 1
    return
  }
  console.log('\ncanary passed')
}

main().catch((e) => {
  console.error('canary crashed:', e)
  process.exitCode = 1
})
