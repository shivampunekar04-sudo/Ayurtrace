# AyurTrace — Complete-B Integration Contract

Complete-B integrates with the ledger **only** through the frozen contract. This file is the
single reference for that boundary, so B never reads Complete-A's source.

## The frozen surface (from the bundled `*.ts.txt`)

- **Reject codes** (`domain.ts.txt`): `ZONE_VIOLATION`, `SEASON_VIOLATION`, `QUOTA_EXCEEDED`,
  `LICENSE_INVALID`, `PART_VIOLATION`, `MASS_BALANCE_VIOLATION`, `WEIGHT_VARIANCE_HOLD`,
  `BATCH_STATUS_HOLD`, `ENDORSEMENT_MISSING`. Each has copy in `REJECT_MESSAGES`.
- **GACP states**: `ACTIVE → HOLD → COMPLETE_PASSED | COMPLETE_FAILED`. Checkpoints `CP-1..CP-7`.
- **Events** (`epcis.ts.txt`): `ObjectEvent`, `AggregationEvent`, `TransformationEvent`,
  `QualityTestEvent`; vendor fields under the `ayurtrace:` namespace.
- **REST endpoints** (`api.ts.txt`, §6.4):
  `POST /events/{collection,aggregation,transformation,quality-test,formulation}`,
  `GET /batch/:epc`, `GET /zones`, `GET /zones/:id/quota`, `POST /recall/:epc`,
  `GET /qr/:serial/verify`. Success `{ok:true,data}`; reject `{ok:false,code,message,detail}`.
- **Composite keys** (`keys.ts.txt`): `species~zone~season`, `batch~event`, `cluster~collector`.

**Rule:** build B's request/response types by importing these — do not hand-copy shapes and do
not add fields. If B needs a new field or endpoint, that's a contract change: stop and request
it from the contract owner. Adding it yourself is the one move that couples B to A.

## Developing without Complete-A: the mock gateway

`mock-gateway/mock-gateway.mjs` (Node built-ins only) serves the entire §6.4 API with
contract-shaped responses drawn from real captured data.

```
cd mock-gateway && node mock-gateway.mjs      # http://localhost:3001
```

It behaves like the real gateway for B's purposes:
- `POST /events/collection` — commits, or returns `ZONE_VIOLATION` when `lat > 18`,
  `PART_VIOLATION` for a non-root Ashwagandha part, `400 VALIDATION` for bad input.
- `POST /events/quality-test` — returns `ENDORSEMENT_MISSING` if verifier == testing lab.
- `GET /batch/:epc`, `/zones`, `/zones/:id/quota`, `POST /recall/:epc`, `GET /qr/:token/verify`
  (genuine vs tampered) — all return the exact contract envelopes.

Point every B component at `http://localhost:3001` during development. Keep that base URL in one
config value so switching to a live gateway later is a one-line change.

## Three ways B integrates at the end (none import A's code)

1. **B runs its own ledger** — the chaincode + gateway are contract-defined and shareable; B can
   stand up its own instance and be fully independent.
2. **B points at a live gateway** by URL. One config change.
3. **B demos on the mock** — self-contained showcase of the B components alone.

## What B may and may not do to the contract

- ✅ Import and build against the types. Mock them. Extend B's *own* payloads under the
  `ayurtrace:` namespace only where the event schema already allows extensions.
- ❌ Change reject codes, endpoint paths, GACP states, or core event required fields.
- ❌ Re-implement enforcement that already lives in the chaincode service. B submits through the
  API; it does not duplicate MPR/mass-balance logic. (CP-5/CP-6 are *new* enforcement B adds,
  written in the same pure-function, unit-tested style — that's additive, not duplication.)
