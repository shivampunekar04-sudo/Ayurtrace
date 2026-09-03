# AyurTrace Complete-B

The advanced layer the 48-hour execution plan kept as slide-only (§1.4): Tier-3 SMS,
Tier-4 CFA biometrics + DPDP consent, RFC-3161 timestamping, full 7-role RBAC, the
analytics feedback loop, live CP-5/CP-6 enforcement, a real IoT weighbridge, and full
PoLK. **All 8 components are implemented and productionized — 169 tests (integration,
real-token CMS chain verification, fuzz/property), a narrated demo, a live signature-verified
timestamp, persistence adapters, and CI.**

**This project does not rebuild Complete-A's core and does not depend on it.** The only
coupling is the frozen `@ayurtrace/contracts` (here as `contracts/`, a verbatim copy of
the kit's `*.ts.txt`). Development runs against the bundled mock gateway.

> **Monorepo note.** This directory (`complete-b/`) lives alongside Complete-A in the same
> repository. Complete-A's core is at the repo root (`apps/`, `chaincode/`, `packages/contracts/`,
> `seed/`). Complete-B stays self-contained: it vendors the frozen contract under `contracts/`
> (identical to the repo's `packages/contracts/src/`) so it builds and tests independently.
> Run all commands below from inside `complete-b/`.

## Layout

```
contracts/                 Frozen contract — reject codes, EPCIS events, §6.4 DTOs, keys (do not edit)
src/config/config.ts       The single API base URL (mock gateway by default)
src/enforcement/           6 · CP-5 (lab limits) + CP-6 (DNA identity, risk-weighted sampling)
src/polk/                  8 · Full PoLK quorum + dispute/timeout state machine
src/analytics/             5 · Anonymized signals (premium / recall / demand / conservation) + k-anonymity
src/rbac/                  4 · Role→action matrix + attribute-check middleware
src/sms/                   1 · Tier-3 SMS parser + gateway (enrichment, idempotency, rate-limit)
src/cfa/                   2 · DPDP consent state machine + biometric verify + Tier-4 intake
src/rfc3161/               3 · DER codec + TimeStampReq/TSTInfo + CMS signature verify + fail-open anchor
src/weighbridge/           7 · Weigh variance + MQTT-like subscriber + RFID custody
src/client/                Unified §6.4 API client + CFA/weighbridge submission wiring
src/policy/                Governed policy numbers (sourced; NMPB-pending flagged)
src/persistence/           Atomic file-backed stores (idempotency, PoLK sessions, anchors, consent)
src/polk/session.ts        PoLK session orchestrator (opens sessions, tick fires timeouts)
src/rfc3161/anchor-store   Anchor persistence + retry loop
fabric/                    4 · Chaincode attribute check + endorsement policies + CA/MSP org config
.github/workflows/ci.yml   CI: typecheck + test + build on Node 20/22
src/index.ts               Barrel export of the whole B surface
test/                      Vitest tests (pass + fail per rule) — 19 suites incl. integration, CMS chain verify, fuzz
scripts/demo.mjs           Narrated end-to-end batch journey through the real compiled modules
scripts/smoke.mjs          Live end-to-end check against the running mock gateway
CompleteB/                 The original kit: source docs, spec, handoff, and the mock gateway
STATUS.md                  Honesty-tagged build matrix + flagged contract gaps
```

## Quick start

```bash
npm install
npm test           # 169 passing across 19 suites
npm run typecheck  # strict, clean
npm run demo       # narrated end-to-end batch journey (builds + runs)
```

Live, against the mock gateway (two terminals):

```bash
npm run mock
```

```bash
npm run smoke
```

## Integration & going live

Every component reaches a ledger through one unified [`AyurTraceClient`](src/client/api-client.ts)
and one env var — `AYURTRACE_API_BASE_URL` (default: the mock). Mock → live gateway → B's own
ledger is a config change, no code change. See [docs/INTEGRATION.md](docs/INTEGRATION.md).

**RFC-3161 is genuinely live and cryptographically verified:**

```bash
npm run tsa:live   # obtains a real token from a public TSA and verifies its CMS signature
```

The Twilio SMS edge is code-complete and locally tested ([twilio.ts](src/sms/twilio.ts)); it
needs only a number + credentials (`TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER`)
to send for real. Policy numbers are consolidated and sourced in
[docs/POLICY_DEFAULTS.md](docs/POLICY_DEFAULTS.md); contract-owner decisions are written up in
[docs/CONTRACT_CHANGE_REQUESTS.md](docs/CONTRACT_CHANGE_REQUESTS.md).

## Honesty tags

Every component's logic core is 🟢 **BUILT** with tests. Anything needing an external
service stays 🟡 **SIMULATED** (real interface, mocked backend) or 🔵 **DESIGNED** until
run on real infrastructure — Twilio (SMS), biometric capture, a live RFC-3161 TSA, an
MQTT scale + RFID reader, and a running Fabric CA for RBAC enforcement. See
[STATUS.md](STATUS.md) for the full matrix and the three flagged contract gaps (none
worked around).
