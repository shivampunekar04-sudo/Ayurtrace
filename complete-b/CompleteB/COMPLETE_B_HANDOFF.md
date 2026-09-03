# AyurTrace — Complete-B Handoff (read first)

This project builds **Complete-B**: the advanced layer that the 48-hour execution plan
deliberately kept as *slide-only* (§1.4). Complete-A already built and verified the demoable
core (contracts, chaincode with 45/45 tests, gateway with 14/14 HTTP checks, seed, three UIs).
**This project does not rebuild any of that and does not depend on it.**

---

## 0. What Complete-B is

The components the solution doc specifies but the core build left as roadmap. Each is real,
buildable work here:

1. **Tier-3 SMS gateway** — feature-phone collection via `HERB [species] [qty] [lat,lon] [colID]` short-code.
2. **Tier-4 CFA biometrics + DPDP consent** — Community Field Agent intake with collector thumb-biometric; CFA identity on-chain, revocable; DPDP Act 2023 consent handling.
3. **RFC-3161 trusted timestamping** — export-grade legal validity on `quality_test` certificates.
4. **Full 7-role RBAC** — Fabric CA + MSP per role (Collector, CFA, Aggregator, Processor, Lab, Manufacturer, NMPB/AYUSH, Consumer) with attribute-based write scopes.
5. **Analytics feedback loop (§3E)** — anonymized scan data → premium-price signal, recall geo-targeting, NMPB cultivation-demand intelligence, CSIR-NBRI conservation input.
6. **Live CP-5 / CP-6 enforcement** — moisture/metals/pesticide vs WHO/AYUSH limits (CP-5); DNA barcode ITS2 + psbA-trnH match (CP-6), risk-weighted sampling.
7. **Real IoT weighbridge + RFID (CP-3 hardware)** — MQTT from a real scale; auto custody logging.
8. **Full PoLK** — Proof-of-Local-Knowledge beyond the scripted 2-peer flow.

Source of truth (all in this project's knowledge): the four AyurTrace docs. The execution
plan **§1.4** is your exact scope list. Never contradict the docs.

---

## 1. Independence boundary (the hard requirement)

**Complete-B never imports Complete-A's source and never needs A running.** The only coupling
is the **frozen `@ayurtrace/contracts`** — a neutral shared spec (reject codes, event types,
§6.4 endpoints), included in this kit as `*.ts.txt`. Build strictly against those types.

For development, run the bundled **`mock-gateway/mock-gateway.mjs`** (Node built-ins only):
it serves the §6.4 API with contract-shaped responses, so every B component talks to a fake
ledger that behaves like the real one. `node mock-gateway.mjs` → `http://localhost:3001`.

Three integration options at the end, in order of independence:
- **B runs its own ledger** (the chaincode + gateway are shared, contract-defined; B can stand
  up its own instance and never touch A). Fully independent.
- **B points at A's live gateway** by URL. One config change. No source dependency.
- **B stays on the mock** for a self-contained demo of the B components alone.

If a B component ever seems to *need* a contract change, do **not** invent a field — that's the
one thing that would couple B to A. Note what you need; the contract owner decides.

---

## 2. Honesty tagging (non-negotiable, same as A)

Tag everything **🟢 BUILT / 🟡 SIMULATED / 🔵 DESIGNED**. Most of Complete-B touches external
services that a dev sandbox can't exercise, so be disciplined:

- Needs a real external service to be BUILT: Twilio (SMS), biometric capture hardware, a real
  RFC-3161 TSA, an MQTT scale, a running Fabric CA for RBAC. Until run against the real thing,
  these are **SIMULATED** (real interface, mocked backend) or **DESIGNED**.
- Verifiable purely in code: parsers, validation, DNA/limit-check logic (CP-5/CP-6), analytics
  aggregation, consent state machines, RBAC policy definitions. These can reach **BUILT** with tests.

Never present a Twilio-less SMS flow or a hardware-less weighbridge as BUILT. A single "that's
mocked" catch from a judge costs more than an honest roadmap tag.

---

## 3. Environment constraints (what can be verified where)

| Component | Verifiable in a sandbox? | Needs on your machine / accounts |
|---|---|---|
| SMS parser + submit logic | ✅ logic + tests | Twilio number + webhook to go live |
| CFA consent state machine, biometric *interface* | ✅ logic | biometric device/SDK; DPDP legal review |
| RFC-3161 request/verify logic | ⚠️ partial (can build client) | a real TSA endpoint to produce valid tokens |
| 7-role RBAC policies + MSP config | ✅ config + policy files | Docker + Fabric CA to enforce live |
| Analytics aggregation | ✅ fully | a datastore for scale |
| CP-5/CP-6 enforcement logic | ✅ fully (pure functions + tests) | DNA lab data feed for real inputs |
| IoT weighbridge (MQTT) | ⚠️ can build subscriber + mock publisher | a real scale + broker to go live |
| Full PoLK | ✅ logic + tests | SMS fan-out (Twilio) to go live |

Build the **✅ logic-first** items to BUILT with tests; scaffold the hardware/service items with
a mock and tag them SIMULATED until you run them on your machine.

---

## 4. Recommended build order

Do the ones that reach BUILT in code first (they're demonstrable and low-risk), then the
service-dependent ones:

1. **CP-5/CP-6 enforcement** — pure functions (limit checks, DNA match, risk-weighted sampling), unit-tested. Highest credibility, zero external deps.
2. **Full PoLK** — cluster-quorum logic + dispute/timeout state machine, unit-tested; SMS fan-out mocked.
3. **Analytics feedback loop** — aggregation over event/scan data, deterministic tests.
4. **7-role RBAC** — MSP/CA config + endorsement policies + an attribute-check middleware; enforceable once B runs a network.
5. **SMS gateway** — parser + submit (BUILT logic), Twilio wiring (SIMULATED until your number).
6. **CFA biometrics + DPDP** — consent state machine (BUILT), biometric capture (interface + SIMULATED), on-chain revocable CFA identity.
7. **RFC-3161 timestamping** — TSA client (build), real token generation against a live TSA.
8. **Real IoT weighbridge** — MQTT subscriber + mock publisher (SIMULATED), real scale later.

Keep this file and a status matrix updated as items move BUILT/SIMULATED/DESIGNED.

---

## 5. How to start

Read `COMPLETE_B_SPEC.md` (per-component input/output/integration/failure/security/verify),
`INTEGRATION_CONTRACT.md` (the exact API + the mock), and the four source docs. Run the mock
gateway. Then ask for work one component + one slice at a time — never "build all of B at once."
Use `COMPLETE_B_INSTRUCTIONS.md` for the project instructions + kickstarter.
