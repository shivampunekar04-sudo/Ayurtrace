# Complete-B — Build Status Matrix

Honesty tags: 🟢 **BUILT** (real logic + passing tests) · 🟡 **SIMULATED** (real
interface, mocked backend) · 🔵 **DESIGNED** (spec/config only, needs an external
service or hardware to run).

**All 8 components implemented, composed, and productionized. 169 tests across 19 suites
(incl. end-to-end integration, real-token CMS chain verification, and fuzz/property tests)
+ 6 live smoke checks + a live signature-verified RFC-3161 token; strict typecheck clean.
CI runs typecheck + test + build on Node 20/22. `npm run demo` narrates the full journey.**

**Productionization layer (buildable-in-code, all done):**
- **TSA chain-to-anchor** — [`cms.ts`](src/rfc3161/cms.ts) now verifies the signer→anchor
  certificate chain + id-kp-timeStamping EKU (live-verified against DigiCert's chain).
- **PoLK session orchestrator** — [`src/polk/session.ts`](src/polk/session.ts) holds open
  sessions, records votes, and `tick()` fires the timeout→UNCONFIRMED / dispute→CFA transitions.
- **Submission wiring** — [`src/client/submit.ts`](src/client/submit.ts) sends CFA-intake and
  weighbridge-built requests through the unified client.
- **Anchor retry loop** — [`src/rfc3161/anchor-store.ts`](src/rfc3161/anchor-store.ts) persists
  PENDING anchors and re-drives them until ANCHORED or exhausted.
- **Persistence** — [`src/persistence/`](src/persistence/): atomic file-backed stores behind
  the existing interfaces (idempotency, PoLK sessions, anchors, DPDP consent with erasure).
- **Hardening + CI** — fuzz/property tests (parsers never crash, DER round-trips) +
  [.github/workflows/ci.yml](.github/workflows/ci.yml).

**Three follow-on directions complete, then three deeper code completions:**
- **Live edge taken:** RFC-3161 is **genuinely live and cryptographically verified** —
  `npm run tsa:live` obtains a real token from DigiCert's public TSA and verifies its CMS
  signature against the embedded RSA-4096 TSA cert. The Twilio SMS edge is code-complete +
  locally tested, SIMULATED only until a number + credentials are supplied.
- **Real-gateway switch:** a unified [`AyurTraceClient`](src/client/api-client.ts) covers
  every §6.4 endpoint; switching mock → live is one env var. See [docs/INTEGRATION.md](docs/INTEGRATION.md).
- **Flagged gaps resolved:** policy numbers consolidated + sourced in
  [`src/policy/policy.ts`](src/policy/policy.ts); contract-code gaps written up in
  [docs/CONTRACT_CHANGE_REQUESTS.md](docs/CONTRACT_CHANGE_REQUESTS.md) (not applied to `contracts/`).

**Then, three more buildable-in-code items:**
- **RBAC on-ledger enforcement** — [fabric/](fabric/): chaincode attribute check (parity-tested
  against the middleware, zero drift), endorsement policies, and CA/MSP org definitions.
- **RFC-3161 CMS signature verification** — [`src/rfc3161/cms.ts`](src/rfc3161/cms.ts): full
  SignedData parse + signature verify (RSA/PSS/ECDSA), tested against a real DigiCert token.
- **PoLK fan-out over SMS** — `fanOutPrompts` + `SmsSenderPeerNotifier` wire PoLK to a real
  SMS transport (SIMULATED until Twilio credentials).

| # | Component | Status | Built here (tested) | Left SIMULATED / DESIGNED |
|---|-----------|--------|---------------------|---------------------------|
| 6 | **CP-5 / CP-6 enforcement** | 🟢 BUILT | `evaluateCp5` (limits, stricter-of cross-check), `evaluateCp6` (risk-weighted sampling + ITS2/psbA-trnH match) — 22 tests | Real DNA-lab data feed for live inputs |
| 8 | **Full PoLK** | 🟢 BUILT + orchestrated | `evaluatePolk` + fan-out + **`PolkSessionManager`** (opens sessions, records votes, `tick` fires timeout/dispute transitions) — 22 tests | Twilio credentials for real SMS fan-out (🟡) |
| 5 | **Analytics feedback loop** | 🟢 BUILT | premium / recall-geo / demand / conservation signals + k-anonymity — 9 tests | A datastore for scale |
| 4 | **7-role RBAC** | 🟢 BUILT (3 layers) | middleware + **chaincode attribute check (parity-tested)** + **endorsement policies + CA/MSP org config** ([fabric/](fabric/)) — 20 tests | Docker + running Fabric CA to enforce live (🔵) |
| 1 | **Tier-3 SMS gateway** | 🟢 BUILT (logic + adapter) | parser, enrichment, submit + reject→SMS mapping, idempotency, rate-limit, **Twilio webhook + TwiML + REST sender** (locally tested) — 25 tests | A real Twilio number + credentials to go live (🟡) |
| 2 | **CFA biometrics + DPDP** | 🟢 BUILT | consent state machine (grant/withdraw/erase), salted-hash biometric verify, intake gate + attribution — 12 tests | Capture device (🟡), on-chain CFA revocation (🔵), DPDP legal review |
| 3 | **RFC-3161 timestamping** | 🟢 BUILT + **LIVE + CHAIN-VERIFIED** | DER codec, request builder, CMS signature verify (RSA/PSS/ECDSA), **cert chain-to-anchor + timeStamping EKU**, anchor store + retry loop — 19 tests + a live DigiCert token verified end-to-end (signature + EKU + chain) | Supply a pinned CA root for production (the mechanism is built; anchor is operator-provided) |
| 7 | **IoT weighbridge + RFID** | 🟢 BUILT (variance) | `computeWeigh` ±10%, MQTT-like subscriber + mock broker, dropout flag, RFID custody — 11 tests | Real scale + MQTT broker + RFID reader (🟡/🔵) |

## Independence boundary (held)

- Complete-B imports **only** the frozen `contracts/` (verbatim copy of the kit's
  `*.ts.txt`). No Complete-A source is referenced.
- Every ledger call goes through one config value: `src/config/config.ts`
  → `http://localhost:3001` (the bundled mock gateway) by default. `npm run smoke`
  drives real B code (the SMS `HttpCollectionSubmitter`) against it end-to-end.
- **No contract field added or changed.** CP-5/CP-6 and the PoLK/weigh logic are
  *additive* enforcement (they do not re-implement MPR / mass-balance, which stay in
  chaincode; B submits through the API).

## Flagged contract gaps → written up as proposals (still NOT applied to `contracts/`)

Formalized in [docs/CONTRACT_CHANGE_REQUESTS.md](docs/CONTRACT_CHANGE_REQUESTS.md):

1. **CCR-1 — add an `UNAUTHORIZED` reject code** for RBAC denials (exact enum + message given).
   Until applied, `rbac.toRejectEnvelope` returns a non-contract 403 with
   `UNAUTHORIZED_PENDING_CONTRACT_CODE` rather than mislabelling as `LICENSE_INVALID`.
2. **CCR-2 — PoLK `PENDING`.** Recommendation: keep it an off-chain workflow state (current
   behaviour, projects to `DISPUTED`); no contract change unless regulators need it on-chain.
3. **Policy numbers** consolidated + sourced in [`src/policy/policy.ts`](src/policy/policy.ts);
   heavy-metal limits are SOURCED (WHO/FAO/AYUSH), pesticide aggregate + CP-6 sampling ratio +
   season windows are marked PENDING NMPB sign-off. See [docs/POLICY_DEFAULTS.md](docs/POLICY_DEFAULTS.md).

## Verify

```bash
npm install          # typescript, vitest, @types/node
npm test             # 169 passing across 19 suites (integration + CMS chain verify + fuzz)
npm run typecheck    # strict, clean
npm run build        # emit dist/
npm run demo         # narrated end-to-end batch journey (builds + runs)
npm run tsa:live     # obtain + verify a REAL token (signature + EKU + chain) from a public TSA
npm run mock         # terminal 1: mock gateway on :3001
npm run smoke        # terminal 2: 6 live checks against the mock
```
