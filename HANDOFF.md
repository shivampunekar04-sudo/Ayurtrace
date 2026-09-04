# AyurTrace — Build Handoff / Continue-Here

**Read this first.** It orients a fresh Claude (new Project, no memory of the build session)
on exactly what exists, why decisions were made, what's verified, the environment traps
already solved, and where to resume. Combined with the four source-of-truth docs already in
project memory, this is enough to keep building **without starting from scratch**.

---

## 0. What this project is (30-second version)

AyurTrace is a Hyperledger Fabric v2.5 traceability system for India's Ayurvedic herb supply
chain (hackathon problem **SH-HLT-10**). It encodes NMPB geo-fences, conservation quotas, and
GACP checkpoints **in chaincode**, so a non-compliant collection or a diluted batch is
**rejected at commit time and attributed to its actor**. The core differentiator is the
**mass-balance merge**: N farms → 1 lot with proportions retained, which solves the
"brokers mix 20 farms and source is lost forever" problem.

**Claim discipline (non-negotiable):** we say compliance is *"detectable, attributable, and
enforced at checkpoints,"* never *"impossible to commit."* Every artifact carries a
**🟢 BUILT / 🟡 SIMULATED / 🔵 DESIGNED** tag. Never present DESIGNED as working.

**Four source-of-truth docs (already in project memory — do not contradict them):**
`International_hackathon_solution_v2.md`, `The_complete_problem_statement.md`,
`AyurTrace_Execution_Plan_v2_48h.md`, `AyurTrace_Team_Schedule_v2_48h.md`.
This handoff describes the *code that has been written against those docs.* If code and docs
ever disagree, the docs win and the code is the bug.

---

## 1. Build status — what is real vs not

| Component | Status | How it was verified |
|---|---|---|
| `@ayurtrace/contracts` (frozen types, reject codes, DTOs, keys) | 🟢 BUILT | tsc clean, `strict` + `noUncheckedIndexedAccess` |
| MPR chaincode — 5 atomic checks + mass-balance + CP-4/CP-7 + endorsement + GACP score | 🟢 BUILT | **45/45** tests (`npm test` in `chaincode/ayurledger`) |
| Fabric `Contract` adapter (`ChaincodeStub`→`LedgerPort`) | 🟢 BUILT | type-checks vs real `fabric-contract-api` 2.5 |
| In-memory `MemoryLedger` (dev/demo adapter) | 🟢 BUILT | powers tests + demo gateway |
| NestJS gateway (§6.4 endpoints, class-validator, typed reject filter, ed25519 QR) | 🟢 BUILT | **14/14** HTTP checks (`apps/gateway/golden-path.mjs`) |
| Registry read endpoints (`/batches /species /collectors /stats`) | 🟢 BUILT | power the dashboards; parity method on contract + all 3 backends |
| **Live backend** (`LEDGER_BACKEND=live`) — durable file ledger + real clock | 🟢 BUILT | `FileLedger` + `LiveLedgerBackend`; seeds on empty, persists per write, rolls back rejects |
| **Served dashboards** (`apps/gateway/web`) — collector/operator/regulator/consumer + overview | 🟢 BUILT | same-origin, live-only, no fake fallback; verified in-browser end to end |
| Seed data (5 species, 3 zones, 4 collectors, quotas) | 🟢 BUILT | deterministic; drives tests + UIs |
| Original self-contained HTML prototypes (consumer/collector/regulator) | 🟢 BUILT | design reference; superseded by the served dashboards |
| Tier-2 offline sync | 🟡 SIMULATED | queue UI real; sync via signal toggle |
| IoT weighbridge (CP-3), PoLK, species photo-check | 🟡 SIMULATED | interface real, backend mocked |
| **Live 3-org Fabric network** | 🔵 **DESIGNED** | adapter written + type-checks; needs Docker + `fabric-samples` (never run against a peer) |
| CP-5/CP-6 live, IPFS, RFC-3161, Tier-3 SMS, Tier-4 CFA, export bundle, 7-role RBAC | 🔵 DESIGNED | architecture only (execution plan §1.4) |

**The single most important honesty point:** the system has **never run on an actual Fabric
peer.** The chaincode logic is proven correct in isolation and the Fabric adapter compiles
against the real SDK, but "it runs on the blockchain" is DESIGNED, not BUILT. That is the
first thing to build next (Phase-0 / M0). See `infra/README.md`.

---

## 2. Architecture in one seam

Everything hinges on one interface so the same enforcement logic runs in three contexts:

```
UIs ──HTTP──▶ NestJS gateway ──▶ LedgerBackend (port)
                                   ├── DemoLedgerBackend  → AyurLedgerService → MemoryLedger   (runs now, no Docker)
                                   └── FabricLedgerBackend → chaincode on Fabric via SDK         (DESIGNED; M0)

Chaincode side: AyurLedgerContract (Fabric entrypoint) ──▶ AyurLedgerService ──▶ LedgerPort
                                                                                   └── FabricLedger (ChaincodeStub)
```

`AyurLedgerService` is the **one** place enforcement lives. It depends only on `LedgerPort`
(get/put/delete/compositeKey/partialQuery/txId/txTime). Swap the adapter, same logic.
`LEDGER_BACKEND=demo|fabric` selects the gateway backend — nothing else changes.

**Why this matters for you:** you can build and test *all* business logic against
`MemoryLedger` with zero infrastructure, then flip to Fabric for the real run. Do not
duplicate enforcement logic into the gateway or the UIs — it belongs in the service.

---

## 3. The frozen contract surface (do not drift from this)

Every lane builds against `@ayurtrace/contracts`. Changing it means telling both projects.
The current frozen surface:

**Reject codes** (`RejectCode`, `packages/contracts/src/domain.ts`): `ZONE_VIOLATION`,
`SEASON_VIOLATION`, `QUOTA_EXCEEDED`, `LICENSE_INVALID`, `PART_VIOLATION`,
`MASS_BALANCE_VIOLATION`, `WEIGHT_VARIANCE_HOLD`, `BATCH_STATUS_HOLD`, `ENDORSEMENT_MISSING`.
Each has human copy in `REJECT_MESSAGES` — UIs map code→message, never parse prose.

**GACP states** (`GacpStatus`): `ACTIVE → HOLD → COMPLETE_PASSED | COMPLETE_FAILED`.
**Checkpoints** (`Checkpoint`): `CP-1 … CP-7`.

**EPCIS 2.0 events** (`packages/contracts/src/epcis.ts`): `ObjectEvent` (commissioning /
shipping / receiving), `AggregationEvent` (parentID + childEPCs), `TransformationEvent`
(inputQuantityList → outputQuantityList + `declaredLossFactor` + input-link proportions),
`QualityTestEvent`. Vendor fields live under the `ayurtrace:` namespace.

**REST endpoints** (`ENDPOINTS`, §6.4): `POST /events/{collection,aggregation,transformation,
quality-test,formulation}`, `GET /batch/:epc`, `GET /zones`, `GET /zones/:id/quota`,
`POST /recall/:epc`, `GET /qr/:serial/verify`. Success = `{ok:true,data}`;
reject = `{ok:false,code,message,detail}`.

**Composite keys** (`packages/contracts/src/keys.ts`): quota `species~zone~season`,
`batch~event`, `cluster~collector`. EPC URN builders for lot/container/output/serial/species/zone.

**Chaincode service methods** (`chaincode/ayurledger/src/service.ts`): `initLedger`,
`submitCollection`, `submitAggregation`, `submitTransformation`, `submitQualityTest`,
`submitFormulation`, `getBatch`, `listZones`, `zoneQuota`, `recall`.

**Pure MPR functions** (`chaincode/ayurledger/src/mpr.ts`, dependency-free, unit-tested):
`checkGeoFence`, `checkSeason`, `decideQuota`, `checkLicense`, `checkPlantPart`, `runMpr`
(atomic 5-check), `checkMassBalance`, `apportion`, `checkDryingTime` (CP-4),
`checkEndorsement`, `checkFormulationInputs` (CP-7), `gacpScore`.

---

## 4. Decisions already made (don't relitigate without reason)

1. **EPCIS 2.0, not FHIR** — supply-chain standard; `TransformationEvent` models the merge.
   The problem statement said "FHIR-style"; this is a deliberate, defensible swap. Prepare a
   judge justification or a thin FHIR read-adapter at the gateway (open item).
2. **Enforcement is hand-written + unit-tested, never vibe-coded.** UI scaffolding is the
   AI-acceleration target. Keep this boundary.
3. **Offline quota = cluster soft-reserve.** Offline events get an on-device allow/deny at cut
   time, then reconcile on sync; over-draw commits *flagged* and decrements next season — not a
   silent pass, not a reject-after-cut.
4. **Lab endorsement = lab + incentive-independent verifier** (NMPB regulator, or a second
   lab for export). The manufacturer cannot self-endorse a PASS.
5. **GPS privacy:** zone-level public; precise coords regulator-only for endangered species.
6. **Local demo is the primary path** (network-independent = safe on stage). The `LedgerPort`
   seam + `MemoryLedger` exist for this reason.
7. **UIs shipped as self-contained HTML, not the planned Next.js/Tailwind/shadcn stack.** This
   was a single-shot-delivery tradeoff: no build toolchain, instantly viewable, offline-capable.
   **They are a working reference + design spec, not the production frontend.** Porting them into
   the planned Next.js apps is legitimate remaining work (see §6).
8. **Design language:** botanical green on warm paper, serif display, wax-seal verification
   motif. Shared CSS tokens are duplicated in each HTML file's `:root`.

---

## 5. Environment traps already solved (these save hours — do not rediscover)

- **`npm install` fails with `Unsupported URL Type "workspace:"`** inside sub-packages → the
  packages use plain `file:` deps, not `workspace:`. Install per package.
- **All shared packages are ESM** (`"type":"module"`). Any new Node app that imports them must
  also be `"type":"module"` or tsc throws TS1479.
- **`fabric-contract-api` is CommonJS.** Under ESM, import it as **default** then destructure:
  `import pkg from 'fabric-contract-api'; const { Contract, Info, Transaction } = pkg;`
  Named ESM imports of `Info`/`Transaction` fail at runtime. (Already done in `contract.ts`.)
- **`fabric-shim` iterator quirk:** `getStateByPartialCompositeKey` intersects `AsyncIterable`
  onto the *Promise*; iterate the promise directly (`for await (const kv of stub.getState…())`),
  and wrap `Uint8Array` values with `Buffer.from(...)`.
- **Chaincode package exposes subpath exports** (`ayurledger/service`, `ayurledger/ledger`) so
  the gateway's demo backend imports the pure service **without** pulling in the Fabric layer.
- **`tsx` cold-start on NestJS is slow.** Build to `dist` and run `node dist/main.js` for fast
  boot; the in-process test (`golden-path.mjs`) boots Nest programmatically on an ephemeral port.
- **Testing:** chaincode tests use `node:test` via `tsx`; avoid `before` (stale types) — seed at
  module scope with top-level await.

---

## 6. Where to resume (prioritized)

**P0 — make "runs on Fabric" true (the biggest honesty gap).**
Stand up `fabric-samples` test-network (3 orgs + regulator read-node, CouchDB), deploy
`chaincode/ayurledger` (its `contract.ts` is ready), run `InitLedger`, then start the gateway
with `LEDGER_BACKEND=fabric`. Endorsement policy for `quality_test` must require lab + an
independent org (see `infra/README.md`). Verify by pointing `golden-path.mjs` at the live gateway.

**P1 — port UIs to the planned Next.js/Tailwind/shadcn stack** (if the team wants the
production frontend). Reuse the exact API calls and the design tokens from the HTML files;
add Dexie for the real Tier-2 offline queue, react-leaflet for the regulator map.

**P2 — promotions from the execution plan (decide at H30):** real Tier-2 offline sync (C),
real IPFS anchoring with CID on-chain (B+E), CP-4 already built. Export bundle only if core is on track.

**P3 — open items needing human/NMPB input:** real NMPB zone polygons (geojson.io), sourced
quota/loss-factor numbers to replace `[ASSUMPTION]` seeds, broker-adoption argument, FHIR-swap
defense, DNA-sampling ratio policy number.

**Always:** keep the BUILT/SIMULATED/DESIGNED tags accurate as things move; update this file
and the README status matrix whenever a row changes state.

---

## 7. How to run what exists (sanity check before you build)

```bash
(cd packages/contracts && npm install && npm run build)
(cd seed && npm install && npm run build)
(cd chaincode/ayurledger && npm install && npm test)          # expect 45/45
(cd apps/gateway && npm install && npm run build)
(cd apps/gateway && LEDGER_BACKEND=demo PORT=3001 npm start)   # gateway on :3001
(cd apps/gateway && LEDGER_BACKEND=demo node golden-path.mjs)  # expect 14/14
# open apps/{consumer-pwa,collector-pwa,regulator}/index.html
./scripts/reset-demo.sh                                        # deterministic re-seed + replay
```

If those two numbers (45/45, 14/14) reproduce, the handoff is intact and you're building on a
verified base.

---

## 8. Generate-per-lane workflow (how to ask a fresh Claude to continue)

Same as the original vibe-coding loop. Upload to the new Project: the four source docs, **this
HANDOFF.md**, and `FILE_MANIFEST.md`. Then request work by lane + component, e.g.:
*"Using the frozen contracts in §3, implement the real Tier-2 offline queue in the collector
PWA (Dexie), matching `POST /events/collection`."* Claude should read the manifest to see what
already exists before generating, and never regenerate a 🟢 BUILT file from scratch — edit it.
