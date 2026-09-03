# Policy Defaults & Sources

Every policy-tunable number lives in one governed module — [`src/policy/policy.ts`](../src/policy/policy.ts) —
so NMPB/AYUSH can review and set them in a single place. Each is tagged **SOURCED** (backed by a
cited standard, safe to use) or **PENDING** (a real policy decision required; the default is an
honest 🔵 DESIGNED placeholder).

## CP-5 lab limits

| Metric | Default | Unit | Status | Source |
|--------|---------|------|--------|--------|
| Lead (Pb) | 10 | mg/kg | ✅ SOURCED | FAO/WHO & AYUSH herbal ceiling |
| Arsenic (As) | 3 | mg/kg | ✅ SOURCED | AYUSH/WHO (stricter As limit) |
| Mercury (Hg) | 1 | mg/kg | ✅ SOURCED | FAO/WHO & AYUSH herbal ceiling |
| Cadmium (Cd) | 0.3 | mg/kg | ✅ SOURCED | FAO/WHO & AYUSH herbal ceiling |
| Moisture | 10 | % | ✅ SOURCED (general) | WHO QC methods; species-specific in the API |
| Pesticide (aggregate) | 0.1 | mg/kg | ⚠️ PENDING | Placeholder — real control is **per-analyte MRLs**, not one aggregate |

The heavy-metal ceilings match the WHO/FAO limits also adopted by AYUSH (arsenic is the stricter
3 mg/kg). CP-5 enforces the **stricter** of the contract-supplied per-metric limit and these
references, so a lab submitting a lenient limit cannot pass an over-limit value.

**Pesticides need real work:** WHO/pharmacopoeial control specifies MRLs per analyte (e.g. DDT and
metabolites, aldrin/dieldrin, etc.), not a single aggregate. Replace `PESTICIDE_AGGREGATE_LIMIT`
with an analyte-keyed MRL table before any real use.

## CP-6 DNA sampling

| Parameter | Default | Status | Notes |
|-----------|---------|--------|-------|
| Endangered / flagged / export | 100% | ✅ policy | Always sampled (mandatory categories) |
| Baseline statistical ratio | 0.20 | ⚠️ PENDING | NMPB risk-based policy number required |

Barcoding every batch is cost/time-prohibitive (solution §2C), so CP-6 runs at 100% on the
mandatory categories and a deterministic statistical sample otherwise. The 20% baseline is a
placeholder pending an NMPB-backed number; the multi-marker choice (ITS2 + psbA-trnH) follows the
standard medicinal-plant authentication approach (ITS2 higher resolution, psbA-trnH corroborating).

## SMS enrichment (Tier-3)

| Parameter | Default | Status | Notes |
|-----------|---------|--------|-------|
| Season windows | Rabi Oct–Mar / Kharif Jun–Sep / Zaid Apr–May | ⚠️ PENDING | Placeholder cropping calendar; NMPB per-species windows required |
| Default plant part | ASWG→ROOT, BRAH→WHOLE, SARP→ROOT, KUTK/JATA→RHIZOME | partly SOURCED | Common species SOURCED; KUTK/JATA PENDING confirmation |

## Using it

`pendingPolicyItems()` returns the still-PENDING entries so an operator dashboard or startup log
can show exactly what awaits NMPB sign-off. All values are overridable at call sites (e.g. pass a
`Cp6SamplingPolicy` to `evaluateCp6`, or `Cp5Options` to `evaluateCp5`).

## Sources

- FAO/WHO & AYUSH heavy-metal limits for herbal material (Pb 10, As 3, Hg 1, Cd 0.3 mg/kg) — WHO
  *Quality control methods for medicinal plant materials*; AYUSH export-testing notification.
- DNA barcoding of medicinal plants with ITS2 and psbA-trnH multi-marker authentication.
