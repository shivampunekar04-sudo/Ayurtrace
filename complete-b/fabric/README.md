# Fabric artifacts — 7-role RBAC (component 4)

The config + chaincode layer that makes the RBAC model *enforceable on the ledger*, mirroring
the gateway middleware in [`src/rbac/`](../src/rbac/).

| File | What it is | Tag |
|------|-----------|-----|
| [chaincode/rbac-attribute-check.ts](chaincode/rbac-attribute-check.ts) | Chaincode gate: reads the caller's cert `role` attribute and enforces the write matrix before MPR. Mirrors `src/rbac/roles.ts`; `test/fabric-rbac.test.ts` asserts zero drift. | 🟢 BUILT code / 🔵 enforced live on a peer |
| [config/configtx-policies.yaml](config/configtx-policies.yaml) | Channel endorsement policies per event type + read ACLs. Encodes the incentive-independent dual-endorsement rule for `quality_test`. | 🟢 BUILT config / 🔵 applied by configtxgen |
| [config/fabric-ca-orgs.yaml](config/fabric-ca-orgs.yaml) | One CA per org; registers role-scoped identities with `role`/`cfa`/`accredited` attributes; revocation via CRL. | 🟢 BUILT config / 🔵 run against fabric-ca-server |

## Three enforcement layers (defence in depth)

1. **Gateway middleware** (`src/rbac/rbac.ts`) — first gate; fast, typed, unit-tested.
2. **Endorsement policies** (`configtx-policies.yaml`) — the ordering/commit boundary requires
   the right MSP signatures; `quality_test` needs Lab **and** an independent Regulator/2nd-Lab.
3. **Chaincode attribute check** (`rbac-attribute-check.ts`) — re-verifies the caller's `role`
   attribute independently, so a bypassed gateway still cannot write a forbidden event.

All three encode the **same** role→action matrix. The middleware and chaincode copies are kept
in lock-step by a parity test; the endorsement policies express it as signature policies.

## What "live" needs (🔵 DESIGNED here)

Docker + a Fabric network: `fabric-ca-server` per org (issues the attribute certs), `configtxgen`
to apply the policies, and the chaincode deployed with `assertAuthorized(...)` called at the top
of each write transaction. On this machine the artifacts are complete and parity-tested; they
enforce once you stand up the network. The authorization denial code is pending **CCR-1** (see
[../docs/CONTRACT_CHANGE_REQUESTS.md](../docs/CONTRACT_CHANGE_REQUESTS.md)).
