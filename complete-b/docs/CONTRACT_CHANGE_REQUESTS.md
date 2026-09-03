# Contract Change Requests (for the contract owner)

Complete-B is forbidden from editing the frozen `@ayurtrace/contracts` — that is the one
move that would couple B to A. Where a component genuinely needs a contract change, B **stops
and requests it here** instead of inventing a field. Nothing in this file has been applied to
`contracts/`. Each request states the need, the exact proposed change, and how B behaves today
without it.

---

## CCR-1 — Add an `UNAUTHORIZED` reject code (RBAC)

**Need.** The 7-role RBAC gate (`src/rbac/`) denies writes before MPR. An authorization denial
has **no representation** in the frozen `RejectCode` enum, so it cannot be surfaced through the
typed reject envelope (`Rejected`) the way every business reject is.

**Why not reuse an existing code.** `LICENSE_INVALID` is about collector registration, not
authorization; overloading it would corrupt the audit trail and the collector PWA's reject UI.
None of the nine codes fits.

**Proposed change (additive, backward-compatible):**
```ts
// domain.ts — RejectCode enum
UNAUTHORIZED = 'UNAUTHORIZED',

// domain.ts — REJECT_MESSAGES
[RejectCode.UNAUTHORIZED]:
  'Your role is not permitted to perform this action.',
```
Additive only — no existing code, path, or field changes; existing clients keep working.

**How B behaves today (no change applied).** `src/rbac/rbac.ts` `toRejectEnvelope` returns a
NON-contract 403 with `code: 'UNAUTHORIZED_PENDING_CONTRACT_CODE'` rather than mislabelling the
denial. On approval, switch that single `code` to `RejectCode.UNAUTHORIZED` and drop the 403 shim.

---

## CCR-2 — PoLK `PENDING` / CFA-review state (decision, not necessarily a change)

**Need.** Spec §8 describes a disputed claim going to **PENDING** with a CFA review within 48h.
The frozen `PolkAttestation.status` is only `CONFIRMED | UNCONFIRMED | DISPUTED` — there is no
`PENDING`.

**B's current handling (no change needed).** B treats the 48h CFA review as an **off-chain
workflow state** (`PolkEvaluation.workflow = 'DISPUTED_PENDING_CFA'`) that projects onto the
frozen on-chain status `DISPUTED`. This keeps the ledger contract intact and loses no information
(the review deadline is tracked in B).

**Options for the owner:**
- **A (recommended, no change):** keep `PENDING` as an off-chain workflow state; on-chain stays
  `DISPUTED`. Zero contract impact.
- **B (only if a distinct on-chain state is required):** add `PENDING` to
  `PolkAttestation.status`. This is a breaking read-model change (every consumer of the union
  must handle the new value) — do not do this unless regulators need `PENDING` on-chain.

**Recommendation:** Option A. No contract change.

---

## CCR-3 — (Not requested) confirmation that SMS enrichment needs no field

Tier-3 SMS lacks `season` and `plantPart`, both **required** by `CollectionRequest`. B fills them
server-side (season from date, part from the species' GACP-permitted part) rather than adding
request fields. **No contract change requested** — this is recorded so the owner knows the fields
are enriched, not collected, on the TIER3 path. See `src/sms/enrichment.ts` and
`docs/POLICY_DEFAULTS.md`.
