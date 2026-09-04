# infra/fabric — live Hyperledger Fabric run (🟢 BUILT)

The `ayurledger` chaincode **now runs on a real Hyperledger Fabric v2.5 peer** — it is no
longer only DESIGNED. This directory holds the reproducible scripts that stand up the network,
deploy the chaincode, and exercise MPR enforcement on-chain.

## Verified on-peer (2026-09-04)

Deployed to the `fabric-samples` **test-network** (Org1 + Org2 + orderer, **CouchDB** state DB),
channel `provenance-channel`, chaincode committed at seq 1 with `[Org1MSP: true, Org2MSP: true]`.

| Invocation | On-chain result |
|---|---|
| `InitLedger` | commits; seeds 5 species / 4 zones / collectors / quotas |
| `SubmitCollection` valid (Ashwagandha, zone 7) | **commits** → `urn:ayurtrace:lot:CE-KA-ASWG-2026-000001`, GACP 40 |
| `SubmitCollection` out-of-zone (Mumbai) | **rejected** `ZONE_VIOLATION`, tx does not commit |
| `SubmitCollection` wrong part (leaf) | **rejected** `PART_VIOLATION`, tx does not commit |
| `Stats` / `ListZones` / `ListBatches` | read live CouchDB state |

So the enforcement is genuinely *enforced at commit time and attributed to its actor* on a
real ledger — not simulated.

### Scope / honesty
- This is the **2-org** test-network with the default **MAJORITY** endorsement policy (both
  orgs must endorse — a real dual-endorsement, incentive-independent boundary for the demo).
- The bespoke **4-org topology** (Collector / Lab / Manufacturer / NMPB) and the
  `quality_test = AND(Lab, independent-verifier)` **signature policy** in
  [`../../complete-b/fabric/config`](../../complete-b/fabric/config) remain 🔵 DESIGNED.

## Deployment model — Chaincode-as-a-Service (CCaaS)

The chaincode runs as its **own container** that the peer dials over gRPC, instead of the peer
building a chaincode image itself. This is required here: Fabric 2.5's legacy peer-side Docker
image builder is **incompatible with Docker Engine 29.x** (the build stream dies with
`write /run/docker.sock: broken pipe`). CCaaS sidesteps that entirely and is the recommended
model anyway. The image is built with the host `docker build` (which works fine on Docker 29).

## Prerequisites (one time)

1. **Docker Engine + WSL2 Ubuntu** with the Docker daemon running (systemd).
2. **fabric-samples v2.5.9 + binaries + images** in `~/fabric-samples`:
   ```bash
   cd ~ && curl -sSL https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh | bash -s -- --fabric-version 2.5.9 --ca-version 1.5.12 docker samples binary
   ```
3. **Node.js** (for building the package): `node --version` (v18+).
4. **Host prep** (docker-compose shim, container DNS, jq):
   ```bash
   sudo ./setup-host.sh
   ```

## Run

```bash
# 1. build the self-contained CCaaS package -> ~/ayurledger-cc
./build-package.sh /path/to/Ayurtrace-main

# 2. bring up the network, deploy, InitLedger
./deploy.sh

# 3. demonstrate enforcement (valid commit + two rejects)
./invoke-examples.sh
```

> **Keep an Ubuntu terminal open while using the network.** WSL2 tears down the distro (and
> the containers) when the last session closes. Re-run `./deploy.sh` after a reboot / shutdown.

Tear down: `cd ~/fabric-samples/test-network && ./network.sh down`.

## Why the package is built the way it is (see `build-package.sh` header)

- **Vendored** `@ayurtrace/contracts` + `@ayurtrace/seed` — their `file:` deps don't exist in a
  build container. Compiled alongside the chaincode.
- **CommonJS** output — the Fabric 2.5 chaincode runtime is Node 18, which cannot `require()`
  ESM. (Authoring stays ESM; only the deploy build is CJS, via NodeNext + `"type":"commonjs"`.)
- **One-line patch**: `contract.ts` `import type { Context }` → `import { Context }`. With
  `emitDecoratorMetadata`, a type-only Context is erased to `Object`, so fabric-contract-api
  counts the injected `ctx` as a client arg ("Expected 1 parameters, but 0 supplied"). A value
  import records the real class so the framework filters `ctx` out. Original source untouched.

## Gateway → live ledger (🟢 BUILT)

The NestJS gateway now runs against the live peer end-to-end
(HTTP → `@hyperledger/fabric-gateway` → gRPC → peer → chaincode → CouchDB):

```bash
./build-gateway.sh /path/to/Ayurtrace-main   # build gateway + deps into ~/ayurtrace
./run-gateway.sh                              # LEDGER_BACKEND=fabric, Org1 User1 identity, :3001
```

Verified over REST (`http://localhost:3001`):
- `GET /stats` `/zones` `/species` `/batches` — read live ledger state
- `POST /events/collection` (valid) — **commits**, returns `{ok:true,data:{epc,txId,gacpScore}}`
- `POST /events/collection` (out-of-zone / wrong-part / over-quota) — returns the frozen reject
  envelope `{ok:false,code:ZONE_VIOLATION|PART_VIOLATION|QUOTA_EXCEEDED,message,detail}`
- `GET /` and the `*.html` dashboards are served from the same origin

**Live-path fix applied** (`apps/gateway/src/ledger/fabric.backend.ts`): a chaincode reject
arrives over fabric-gateway inside the `GatewayError.details[]` (per-endorser), not in
`error.message`. `parseError()` now scans `message` + `cause` + `details[]` so business rejects
map to the typed `LedgerReject` (and the frozen HTTP envelope) instead of a generic 500. The
demo backend never exercised this because it throws `LedgerReject` directly.

Identity: the gateway uses the test-network **Org1 `User1`** enrollment. Writes are endorsed by
both orgs via gateway service discovery (anchor peers are set by `deploy.sh`).
