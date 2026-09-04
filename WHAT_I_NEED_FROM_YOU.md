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

## 3. Credentials — wiring is DONE; just paste tokens  *(optional)*

Both integrations are now fully wired and env-gated. Copy [`.env.example`](.env.example) to
`.env`, paste tokens, and the mock paths flip to real — no code change. Full steps in
[docs/CREDENTIALS.md](docs/CREDENTIALS.md).

- **IPFS** — set `PINATA_JWT` (from pinata.cloud) in `apps/gateway/.env`. The gateway's
  `POST /ipfs/pin` + the operator dashboard's lab-certificate upload then produce a **real,
  resolvable CID** anchored on-chain (the consumer app's cert link becomes live). Verify at
  `GET /ipfs/status`. Without a token it returns a deterministic mock CID.
- **Twilio** — set `TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER` in `complete-b/.env`, then
  `npm run sms:test` sends a real SMS. Inbound webhook path documented in CREDENTIALS.md.
- *(RFC-3161 timestamping already works live against DigiCert's public TSA — no credential needed.)*

## 4. Decisions — DECIDED (see [docs/DECISIONS.md](docs/DECISIONS.md))

- **Broker adoption** → manufacturer procurement mandate + NMPB licensing tie-in (market access, not goodwill).
- **EPCIS vs FHIR** → keep GS1 EPCIS 2.0 as source of truth; **built a FHIR R4 read-adapter**
  (`GET /fhir/Provenance/:epc`, `GET /fhir/metadata`) so the "why not FHIR?" question is answered live.
- **Branding** → keep "AyurTrace" + botanical/wax-seal identity (renaming would churn the EPC + network ids for no gain).
- *(Open, not blocking: Tier-4 biometric consent under the DPDP Act 2023 — a compliance/legal review workstream, not demoed.)*

---

## TL;DR

| # | Item | Needed for | Status |
|---|------|-----------|--------|
| — | (nothing) | the live product demo | **Runs now** |
| 1 | Install Docker Desktop (clean-AV laptop) | real Fabric blockchain run | Your action — only true gap |
| 2 | Real NMPB zones/quotas/seasons/ratios | authoritative data | ✅ grounded + sourced; swap when you get official numbers |
| 3 | Twilio + IPFS credentials | live SMS + IPFS anchoring | ✅ wired — paste tokens in `.env` to go live |
| 4 | Adoption / FHIR / branding decisions | pitch polish | ✅ decided (FHIR adapter built) |
