# Key decisions (item #4)

Three calls that were the founders' to make, decided and — where useful — backed by code.

## 1. Broker adoption — how to get the opaque middle to join

**Decision: mandate + licensing tie-in, not goodwill.**

Brokers profit from the exact opaque mixing AyurTrace removes, so they will not adopt for
a premium that rewards the source end. We make **market access**, not goodwill, the lever:

- **Manufacturer procurement mandate.** AYUSH-GMP manufacturers (who need verifiable
  provenance for EU/US export and for their own recalls) require AyurTrace-traced inputs.
  A broker who won't produce a traceable lot simply loses the buyer.
- **NMPB licensing tie-in.** Aggregator/trader licences are conditioned on submitting
  AyurLedger events. Non-participation risks the licence, not just a price.
- The **40% collector premium** stays — but as a pull for the source end, not the mechanism
  for the middle. The middle is moved by demand-side and regulatory pressure.

This is an adoption/GTM position, not a code change. It is stated proactively in the pitch so
a judge's "why would brokers adopt?" is already answered.

## 2. Event model — GS1 EPCIS 2.0, with a FHIR read-adapter

**Decision: keep GS1 EPCIS 2.0 as the source of truth; add a thin FHIR R4 read projection.**

The brief said "FHIR-style." FHIR is a *clinical* interoperability standard; EPCIS 2.0 is the
*supply-chain traceability* standard, and its `TransformationEvent` is the only one that
natively models the N→1 mixing/merge that is the problem's sharpest pain. So EPCIS stays the
storage model — and we removed the "why not FHIR?" objection entirely by **projecting any
batch into FHIR R4 on demand**:

- `GET /fhir/metadata` → a FHIR `CapabilityStatement`.
- `GET /fhir/Provenance/:epc` → a FHIR R4 `Bundle` (`Substance` + `Provenance` +
  `Observation`s for GACP score, quality result, and DNA identity).

It is a pure read projection over the same `getBatch()` every other reader uses — no second
source of truth. Code: [`apps/gateway/src/fhir/`](../apps/gateway/src/fhir). So the honest
line to a judge is: *"We use the actual supply-chain standard for storage and can hand any
clinical system a FHIR view of the same data — here's the live endpoint."*

## 3. Branding — keep "AyurTrace" + the botanical identity

**Decision: keep the name and the design language.**

- **Name:** *AyurTrace* — reads immediately (Ayurveda + traceability), is domain-appropriate,
  and is already consistent across the ledger network id, EPC namespace, and every dashboard.
- **Identity:** botanical green on warm paper, serif display, and the **wax-seal** verification
  motif — it signals provenance/authenticity and reads as trustworthy rather than fintech-cold.
- Renaming now would churn the EPC URN namespace (`urn:ayurtrace:*`), the Fabric network id,
  and every screen for no functional gain. If a sponsor or NMPB co-brand is required later,
  it's a theme-token + title swap, not a rebuild.

> All three are settled so the pitch has no open "we haven't decided" gaps. #2 is the only one
> that carried code; #1 and #3 are positions stated in the deck.
