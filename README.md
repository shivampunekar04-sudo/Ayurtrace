# AyurTrace

**Enforcement infrastructure for India's Ayurvedic herb supply chain.** SmartHorizon
International Hackathon · problem statement **SH-HLT-10**.

AyurTrace records a herb's journey from collection to formulation on a permissioned
Hyperledger Fabric ledger using the **GS1 EPCIS 2.0** event model, and — unlike generic
traceability platforms that only *log* movements — encodes NMPB geo-fences, conservation
quotas, and GACP checkpoints **directly in chaincode**, so a non-compliant collection or a
diluted batch is **rejected at commit time and permanently attributed to its actor**.

> We claim compliance is **detectable, attributable, and enforced at checkpoints** — not
> "impossible to commit." That distinction is deliberate and defended in the solution doc.

---

## Honest status matrix

Every capability is tagged. Nothing designed is presented as working software.

| Capability | Status | Evidence |
|---|---|---|
| Frozen EPCIS 2.0 contracts (`@ayurtrace/contracts`) | 🟢 **BUILT** | compiles under `strict` + `noUncheckedIndexedAccess` |
| MPR chaincode — 5 atomic checks (geo-fence, season, quota, license, part) | 🟢 **BUILT** | 45/45 unit + golden-path tests pass |
| EPCIS `TransformationEvent` mass-balance (N→1 merge) | 🟢 **BUILT** | dilution → `MASS_BALANCE_VIOLATION` in tests |
| GACP checkpoints CP-1/2/4/7 + dual endorsement | 🟢 **BUILT** | tested; incentive-independent verifier enforced |
| GACP score 0–100 + recall traversal (merge → source farms) | 🟢 **BUILT** | tested |
| Fabric `Contract` adapter (`ChaincodeStub` → `LedgerPort`) | 🟢 **BUILT** | type-checks against `fabric-contract-api` 2.5 |
| NestJS gateway (§6.4 endpoints, validation, typed rejects, ed25519 QR) | 🟢 **BUILT** | 14/14 HTTP checks pass end-to-end |
| **Live product** — durable file-backed ledger + 5 dashboards served from the gateway | 🟢 **BUILT** | one URL, real wall-clock, data persists across restarts; no mock, no fake fallback |
| Collector · Supply-chain · Regulator · Consumer dashboards (served at `/`) | 🟢 **BUILT** | every value computed live by the server from ledger state |
| Tier-2 offline queue | 🟡 **SIMULATED** | queue UI real; sync shown via a signal toggle |
| IoT weighbridge (CP-3), PoLK peer confirm, species photo-check | 🟡 **SIMULATED** | real interface, mocked backend |
| Live 3-org Fabric network run | 🔵 **DESIGNED** | `FabricLedgerBackend` written; needs `fabric-samples` + Docker (see `infra/`) |
| CP-5/CP-6 live enforcement, IPFS/RFC-3161, Tier-3 SMS, Tier-4 CFA, export bundle | 🔵 **DESIGNED** | architecture only, per execution plan §1.4 |

**Why the live Fabric run is DESIGNED, not BUILT here:** the chaincode + the Fabric adapter
are complete and type-check against the real SDK, but a live peer needs Docker and
`fabric-samples`, which this build environment can't run. The **in-memory demo backend runs
the identical enforcement service**, so every reject code and state transition you see is
the real chaincode logic — not a mock.

---

## Architecture

```mermaid
graph TD
    subgraph L1["TrustRoot — data integrity at source"]
      COL["Collector PWA (Tier-1 + offline queue)"]
    end
    subgraph L2["AyurLedger — species-aware Fabric v2.5"]
      GW["NestJS gateway (§6.4)"]
      CC["AyurLedger chaincode"]
      MPR["MPR: 5 atomic checks"]
      TX["EPCIS mass-balance merge"]
      GACP["GACP state machine + dual endorsement"]
    end
    subgraph L3["VanaSeal — consumer + regulator"]
      CON["Consumer provenance PWA (signed QR)"]
      REG["NMPB regulator console (map, quota, recall)"]
    end
    COL --> GW --> CC --> MPR --> TX --> GACP --> CON
    GACP --> REG
```

The gateway depends only on a `LedgerBackend` port. `LEDGER_BACKEND=demo` runs everything on
one machine with no network; `LEDGER_BACKEND=fabric` connects to a real peer. Switching is
one env var — controllers, UIs, and contracts never change.

---

## Run it — the live product (one URL)

Prerequisites: Node 18+ and npm. No Docker needed.

```bash
# build the shared packages once
(cd packages/contracts && npm install && npm run build)
(cd seed && npm install && npm run build)
(cd chaincode/ayurledger && npm install && npm run build)

# build + launch the gateway with the durable, real-clock ledger
(cd apps/gateway && npm install && npm run build && npm run start:live)
```

Then open **http://localhost:3001** — one server hosts both the API and all five dashboards:

| Page | Who | What they do |
|---|---|---|
| `/` | everyone | live system overview + role links |
| `/collector.html` | collector | log a harvest; watch the 5 MPR checks pass or reject with a reason |
| `/operator.html` | aggregator · lab · maker | aggregate, mass-balance merge, dual-endorsed lab test, formulate + mint a signed QR |
| `/regulator.html` | NMPB | live zone-quota map, over-harvest alerts, batch audit, one-click recall |
| `/consumer.html` | public | scan/paste a QR token → provenance, GACP score, cryptographic authenticity |

Everything a judge sees is computed live by the server from ledger state — **no mock and no
fabricated fallback**. Data entered persists to `apps/gateway/data/ledger.json` and survives a
restart. `POST /admin/reset-demo` re-seeds to a clean state.

Verify the enforcement with the automated golden path (uses the deterministic demo backend):

```bash
(cd apps/gateway && LEDGER_BACKEND=demo npm run golden-path)   # 14 checks: valid commit → rejects → merge → QR → recall
```

> The original self-contained HTML prototypes still live in `apps/{collector,consumer}-pwa`
> and `apps/regulator` as a design reference. The **served dashboards in `apps/gateway/web`
> are the real product** — same-origin, live-only, no bundled fallback data.

To run on real Fabric, see `infra/README.md`, then start the gateway with
`LEDGER_BACKEND=fabric` and the enrollment env vars.

---

## Repository layout

```
packages/contracts   Frozen EPCIS types, reject codes, API DTOs, composite keys (single source of truth)
chaincode/ayurledger MPR enforcement (pure, unit-tested) + Fabric Contract adapter + in-memory ledger
apps/gateway         NestJS §6.4 REST facade + 3 backends (demo, live, fabric); serves the dashboards
apps/gateway/web     The live product UI — collector, operator, regulator, consumer (same-origin, no mock)
apps/collector-pwa   Original self-contained prototype (design reference)
apps/consumer-pwa    Original self-contained prototype (design reference)
apps/regulator       Original self-contained prototype (design reference)
complete-b           Advanced layer — CP-5/6, RFC-3161, SMS, RBAC, analytics (169 tests)
seed                 Deterministic reference data (5 species, 3 zones, 4 collectors, quotas)
scripts              golden-path replay + reset-demo
infra                DESIGNED 3-org Fabric network notes
```

**Three gateway backends, one `LedgerBackend` port, identical enforcement:**
`demo` (in-memory, deterministic clock — powers the tests), `live` (durable file-backed,
real clock — the product demo), `fabric` (a real peer — DESIGNED, needs Docker).

## Test evidence

- `chaincode/ayurledger` — **45/45** (`npm test`): a passing + failing case for every MPR
  check, mass balance, endorsement, CP-7 gate, GACP score, and the full golden path.
- `apps/gateway` — **14/14** HTTP checks (`(cd apps/gateway && node golden-path.mjs)`): valid commit,
  `ZONE_VIOLATION`, `PART_VIOLATION`, 400 validation, N→1 merge, `MASS_BALANCE_VIOLATION`,
  `ENDORSEMENT_MISSING`, dual-endorsed pass, signed QR mint, genuine + tampered QR verify,
  timeline, quota band, recall to both source farms.
