# infra — 3-org Fabric network (DESIGNED)

The live network is the Phase-0 / M0 task in the execution plan. The chaincode and the
gateway's `FabricLedgerBackend` are complete and type-check against Hyperledger Fabric
v2.5's SDK; this directory documents how to stand the network up. It is **DESIGNED**, not
run in this build (Docker + `fabric-samples` required).

## Topology (demo-minimized)

| Org | MSP | Role |
|---|---|---|
| Collector / NMPB | `CollectorMSP` | write collection events; regulator read |
| Accredited Lab | `LabMSP` | write `quality_test` |
| Manufacturer | `ManufacturerMSP` | write formulation, commission QR |
| NMPB Regulator | `NmpbMSP` | read-only audit; incentive-independent co-endorser |

One channel `provenance-channel`, one chaincode `ayurledger`, state DB **CouchDB** (rich
queries + composite keys for recall and dashboards).

## Endorsement policy (the incentive-independence guarantee)

`quality_test` requires `AND('LabMSP.peer', OR('NmpbMSP.peer','<second-lab>.peer'))` — the
manufacturer cannot self-endorse a PASS. This mirrors `service.checkEndorsement`, so the
rule is enforced at both the application and the channel layer.

## Bring-up (outline)

```bash
# from fabric-samples/test-network
./network.sh up createChannel -c provenance-channel -s couchdb
./network.sh deployCC -ccn ayurledger -ccp <path>/chaincode/ayurledger \
  -ccl typescript -c provenance-channel
# then: InitLedger, and start the gateway with LEDGER_BACKEND=fabric + enrollment env vars
```

Required gateway env for `LEDGER_BACKEND=fabric`: `FABRIC_PEER_ENDPOINT`,
`FABRIC_TLS_CERT_PATH`, `FABRIC_CERT_PATH`, `FABRIC_KEY_PATH`, `FABRIC_MSP_ID`,
`FABRIC_CHANNEL`, `FABRIC_CHAINCODE`.
