# AyurTrace — File Manifest

Every source file, its purpose, and its build status. **Rule for a continuing Claude:** never
regenerate a 🟢 BUILT file from scratch — open it and edit the needed section. 🔵 files are
stubs/entrypoints awaiting a live environment.

## packages/contracts — the frozen integration contract (🟢 BUILT)
| File | Purpose |
|---|---|
| `src/epcis.ts` | GS1 EPCIS 2.0 event types + `ayurtrace:` extensions (Object/Aggregation/Transformation/QualityTest) |
| `src/domain.ts` | `RejectCode`, `REJECT_MESSAGES`, `GacpStatus`, `Checkpoint`, `SpeciesRule`, `Zone`, `Quota`, `Collector`, `BatchRecord` |
| `src/api.ts` | REST request/response DTOs, `Ok`/`Rejected` envelopes, `ENDPOINTS` map (§6.4) |
| `src/keys.ts` | composite-key builders + EPC URN builders |
| `src/index.ts` | barrel export |

## chaincode/ayurledger — enforcement (🟢 BUILT, 45/45 tests)
| File | Purpose | Status |
|---|---|---|
| `src/mpr.ts` | **pure, dependency-free** enforcement: 5 checks, mass-balance, apportion, CP-4, endorsement, CP-7, GACP score | 🟢 |
| `src/service.ts` | `AyurLedgerService` — orchestration over `LedgerPort`; all submit/get/recall methods; `LedgerReject` | 🟢 |
| `src/ledger.ts` | `LedgerPort` interface + `MemoryLedger` (deterministic dev/demo adapter) | 🟢 |
| `src/contract.ts` | Fabric `Contract` entrypoint; `ChaincodeStub`→`LedgerPort` adapter; @Transaction fns | 🟢 typecheck / 🔵 never run on a peer |
| `src/seed-embedded.ts` | re-exports `@ayurtrace/seed` for `InitLedger` | 🟢 |
| `src/index.ts` | fabric-shim contract registration (`contracts = [AyurLedgerContract]`) | 🟢 |
| `test/mpr.test.ts` | unit tests, pass+fail per rule | 🟢 |
| `test/golden-path.test.ts` | end-to-end §9.1 through service + MemoryLedger | 🟢 |

## apps/gateway — NestJS REST facade (🟢 BUILT, 14/14 HTTP checks)
| File | Purpose | Status |
|---|---|---|
| `src/main.ts` | bootstrap: CORS, global ValidationPipe, reject filter, port | 🟢 |
| `src/app.module.ts` | selects demo/fabric backend from `LEDGER_BACKEND`; wires controllers + filter | 🟢 |
| `src/config/env.ts` | backend kind + Fabric enrollment env config | 🟢 |
| `src/ledger/ledger.backend.ts` | `LedgerBackend` port + DI token | 🟢 |
| `src/ledger/demo.backend.ts` | runs real `AyurLedgerService` in-memory (no Docker) | 🟢 |
| `src/ledger/fabric.backend.ts` | production path via `@hyperledger/fabric-gateway` | 🟢 typecheck / 🔵 needs peer |
| `src/common/reject.ts` | gateway `LedgerReject` + duck-typed guard | 🟢 |
| `src/common/reject.filter.ts` | maps any reject → frozen `{ok:false,code,…}` (422) | 🟢 |
| `src/events/dto.ts` | class-validator DTOs = §6.1 edge validation | 🟢 |
| `src/events/events.controller.ts` | `POST /events/*`; formulation mints signed QRs | 🟢 |
| `src/batch/batch.controller.ts` | `GET /batch/:epc` | 🟢 |
| `src/zones/zones.controller.ts` | `GET /zones`, `/zones/:id/quota` | 🟢 |
| `src/recall/recall.controller.ts` | `POST /recall/:epc` | 🟢 |
| `src/qr/qr.service.ts` | ed25519 sign/verify (manufacturer key server-side) | 🟢 |
| `src/qr/qr.controller.ts` | `GET /qr/:token/verify` + on-chain state check | 🟢 |
| `src/admin.controller.ts` | `/health`, `/qr/pubkey`, `POST /admin/reset-demo` | 🟢 |
| `golden-path.mjs` | in-process 14-check §9.1 e2e (boots Nest on ephemeral port) | 🟢 |

## apps/*-pwa, apps/regulator — UIs (🟢 BUILT, self-contained HTML)
| File | Purpose | Notes |
|---|---|---|
| `apps/consumer-pwa/index.html` | QR verify, GACP ring, provenance thread, source-farm traceback, quota bar, report | flagship; real captured demo fallback |
| `apps/collector-pwa/index.html` | pictographic Tier-1 entry, GPS zone-only, offline-queue toggle, reject-code UI | Tier-2 sync is SIMULATED |
| `apps/regulator/index.html` | SVG zone map, quota bands, over-harvest alerts, leaderboard, one-click recall | map is SVG (self-contained), not Leaflet yet |

> UIs target `http://localhost:3001`; fall back to bundled real responses if the gateway is down.
> To go to the planned stack, port these into Next.js/Tailwind/shadcn reusing the same API calls + tokens.

## seed, scripts, infra, docs
| File | Purpose | Status |
|---|---|---|
| `seed/src/index.ts` | deterministic reference data (5 species, 3 zones, 4 collectors, quotas) | 🟢 |
| `scripts/reset-demo.sh` | re-seed + golden-path replay for repeat dry runs | 🟢 |
| `infra/README.md` | 3-org Fabric network bring-up + endorsement policy | 🔵 DESIGNED |
| `README.md` | run instructions + status matrix + test evidence | 🟢 |
| `HANDOFF.md` | this build's state-of-play (read first) | 🟢 |
| `FILE_MANIFEST.md` | this file | 🟢 |
| `SPLIT_GUIDE.md` | how to divide remaining work across two projects | 🟢 |
