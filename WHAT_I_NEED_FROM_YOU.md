# What I need from you

The product is **built and running live** — you don't need to give me anything to demo it.
This list is only for the two remaining things that need *your* real-world inputs or a piece of
software I can't install here, plus a few decisions that are yours to make.

Nothing below blocks the demo. Everything marked **optional** is a "make it even more real"
upgrade, not a gap in what works today.

---

## ✅ Nothing needed to run the live demo

```bash
(cd apps/gateway && npm run build && npm run start:live)
# open http://localhost:3001
```

That's the whole product: five dashboards, real persistence, real enforcement. Ready for judges.

---

## 1. To turn the blockchain from DESIGNED → live on a real peer  *(optional, biggest "wow")*

Right now the enforcement runs on a durable local ledger. The **identical** chaincode is written
and type-checks against Hyperledger Fabric v2.5 — it has just never been run on an actual peer,
because that needs Docker, which isn't installed on this machine.

**What I need from you:** install **Docker Desktop** (and keep it running). That's it — once Docker
is available I can stand up the 3-org `fabric-samples` test network, deploy the chaincode, and flip
the gateway to `LEDGER_BACKEND=fabric` so the dashboards talk to a real blockchain. See `infra/README.md`.

## 2. Real NMPB / AYUSH reference data to replace the `[ASSUMPTION]` seeds  *(optional)*

The demo ships with realistic but **placeholder** reference data. To make it authoritative, give me
whatever of these you can get (even one improves credibility):

- **Real zone boundaries** — GeoJSON polygons for actual NMPB-approved collection zones (draw at
  geojson.io, or an official shapefile). Today's zones are illustrative rectangles in Karnataka.
- **Real conservation quotas** — annual per-species, per-zone kg limits (NMPB/State Medicinal Plants Board).
- **Season windows** per species (GACP/GFCP harvest calendars).
- **DNA sampling ratio** — the policy number for what % of batches get DNA-barcoded (e.g. 100% for
  endangered/export, X% otherwise).
- **Cluster soft-reserve formula** — how offline quota reserves are sized per cluster.
- **Post-harvest loss factors** per process step (for the mass-balance tolerance).

Drop them in `seed/src/index.ts` — send me the numbers and I'll wire them in.

## 3. Credentials, only if you want the DESIGNED integrations live  *(optional)*

These are fully coded in `complete-b/` and tested against mocks; they go live the moment you supply:

- **Twilio** account SID + auth token + a phone number → real Tier-3 SMS collection + PoLK fan-out.
- **IPFS pinning** (e.g. web3.storage/Pinata token) → real certificate anchoring with the CID on-chain.
- *(RFC-3161 timestamping already works live against DigiCert's public TSA — no credential needed.)*

## 4. Decisions that are yours to make  *(no code from me needed — just your call)*

- **Broker adoption lever** — brokers profit from the opaque mixing we remove. Which path: manufacturer
  procurement mandates, NMPB licensing tie-in, or the collector premium? (See solution doc §8.)
- **EPCIS-vs-FHIR framing** — the problem statement said "FHIR-style"; we used GS1 EPCIS 2.0 (the actual
  supply-chain standard). I can add a thin FHIR read-adapter if a judge insists — say the word.
- **Branding** — real product name/logo/colours if you want to move off the current "AyurTrace" botanical theme.
- **Tier-4 biometric consent** under the DPDP Act 2023 — a compliance/legal review workstream (not demoed).

---

## TL;DR

| # | Item | Needed for | Blocks demo? |
|---|------|-----------|--------------|
| — | (nothing) | the live product demo | **No — it runs now** |
| 1 | Install Docker Desktop | real Fabric blockchain run | No |
| 2 | Real NMPB zones/quotas/seasons/ratios | authoritative data | No |
| 3 | Twilio + IPFS credentials | live SMS + IPFS anchoring | No |
| 4 | Adoption / FHIR / branding decisions | pitch polish | No |
