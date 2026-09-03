# AyurTrace — Complete-B Component Spec

One section per component. Each states purpose, inputs, outputs, the frozen-contract
integration point, dependencies, failure/edge cases, security concerns, the honest tag it can
realistically reach, and how to verify it. Build against the contract types in the bundled
`*.ts.txt` and the mock in `mock-gateway/`.

---

## 1. Tier-3 SMS Gateway
**Purpose.** Let a feature-phone collector log a collection with no smartphone.
**Input.** Inbound SMS: `HERB [SPECIES] [QTY] [lat,lon] [COLLECTOR_ID]` (e.g. `HERB ASWG 45 13.34,77.10 NMPB-COL-KA-8823`).
**Output.** A `POST /events/collection` call; SMS reply with batch ID + tx hash, or the reject reason mapped from `REJECT_MESSAGES`.
**Integration point.** Consumes `CollectionRequest` → `/events/collection`; maps `Rejected.code` → SMS copy. `entryMethod: 'TIER3_SMS'`.
**Dependencies.** Twilio (or any SMS provider) inbound webhook; the gateway URL (mock during dev).
**Failure/edge.** Malformed message → helpful SMS template; unknown species/collector → validation reject; duplicate submit (SMS retries) → idempotency key on message SID.
**Security.** Sender number must map to a registered collector; rate-limit per number; never trust lat/lon blindly (it still passes chaincode geo-fence).
**Honest tag.** Parser + submit + reject-mapping → **BUILT** (unit tests on the parser). Live Twilio round-trip → **SIMULATED** until your number is wired.
**Verify.** Unit-test the parser (valid, malformed, unknown-token cases); integration-test the submit against the mock gateway; a scripted single live flow for the demo.

## 2. Tier-4 CFA Biometrics + DPDP Consent
**Purpose.** A Community Field Agent logs on behalf of a collector with no device; collector authenticated by thumb-biometric; CFA identity is on-chain and revocable.
**Input.** CFA session (CFA credential) + collector biometric template hash + explicit consent record + collection fields.
**Output.** A collection event attributed to the collector, co-signed by the CFA identity; a stored, revocable consent artifact.
**Integration point.** `/events/collection` with `entryMethod: 'TIER4_CFA'`; CFA identity in the event's endorser/attribution metadata.
**Dependencies.** Biometric capture SDK/device; a DPDP-compliant consent store; Fabric CA to issue/revoke CFA certs (RBAC item 4).
**Failure/edge.** Consent withdrawn → future writes by that CFA for that collector blocked; biometric mismatch → reject, no event; CFA cert revoked → CA rejects the write.
**Security & law.** DPDP Act 2023: store biometric as a salted hash, not raw; explicit purpose-limited consent; right-to-erasure path. This is a legal workstream, not just code — flag for review.
**Honest tag.** Consent state machine + attribution model → **BUILT**. Biometric capture + on-chain revocation → **SIMULATED/DESIGNED** until device + CA exist.
**Verify.** Unit-test the consent state machine (grant/withdraw/erase) and the block-on-withdrawn rule; mock the capture.

## 3. RFC-3161 Trusted Timestamping
**Purpose.** Export-grade legal proof of *when* a lab certificate existed.
**Input.** The certificate hash (the same content-addressed CID used on-chain).
**Output.** An RFC-3161 timestamp token, stored/anchored alongside the `quality_test` event.
**Integration point.** Augments `QualityTestRequest`/event metadata; does not change core enforcement.
**Dependencies.** A real Time Stamping Authority (TSA) endpoint.
**Failure/edge.** TSA unreachable → event still commits; timestamp marked `pending` and retried (don't block the ledger on an external service).
**Security.** Verify the TSA chain; store the token, not just a boolean.
**Honest tag.** TSA client (build request, parse/verify token) → **BUILT logic**; real tokens → **DESIGNED** until a live TSA is used.
**Verify.** Unit-test request encoding + token parsing against a fixture; one live token for the demo.

## 4. Full 7-Role RBAC
**Purpose.** The complete role model the demo network minimized: Collector, CFA, Aggregator, Processor, Lab, Manufacturer, NMPB/AYUSH, Consumer — each with exact write scopes.
**Input.** Identity (MSP + attributes) on every write.
**Output.** Writes accepted only for the caller's permitted event types; reads scoped per role.
**Integration point.** Chaincode-level `getClientIdentity` attribute checks + channel endorsement policies; gateway maps enrolled identity → role. Uses the same reject codes; adds an authorization gate before MPR.
**Dependencies.** Fabric CA per org; Docker to run the network.
**Failure/edge.** Wrong role writes wrong event → authorization reject; expired/revoked cert → CA rejects; consumer attempts any write → denied.
**Security.** Attribute-based (not just MSP), least privilege; separate the incentive-independent verifier org for `quality_test`.
**Honest tag.** Policy definitions + attribute-check middleware → **BUILT config**; live enforcement → needs a running network (**DESIGNED** here, verified on your machine).
**Verify.** Unit-test the role→allowed-event matrix; policy files reviewed; live enforcement tested when B runs a network.

## 5. Analytics Feedback Loop (§3E)
**Purpose.** Turn anonymized scan + event data into signals: premium-price for high-engagement ethical clusters, recall geo-targeting, NMPB cultivation-demand intel, conservation input.
**Input.** Anonymized scan events, batch/zone/quota state.
**Output.** Aggregates + signals (JSON/dashboards); no PII.
**Integration point.** Reads via `/batch/:epc`, `/zones`, `/zones/:id/quota` and a scan-event feed; produces its own outputs. Read-only w.r.t. the ledger.
**Failure/edge.** Sparse data → suppress low-n signals (privacy); ensure k-anonymity before publishing cluster stats.
**Security.** Strict anonymization; no linking a scan to an individual.
**Honest tag.** **BUILT** — pure aggregation, fully testable.
**Verify.** Deterministic tests over a fixture dataset; assert k-anonymity thresholds.

## 6. Live CP-5 / CP-6 Enforcement
**Purpose.** Make the two lab checkpoints real: CP-5 moisture/heavy-metals/pesticide within WHO/AYUSH limits; CP-6 DNA species confirmation (ITS2 + psbA-trnH) with risk-weighted sampling.
**Input.** Lab metric values + limits (CP-5); declared vs confirmed species barcode result (CP-6); species conservation status (drives sampling ratio).
**Output.** Checkpoint PASS/FAIL feeding `GacpStatus`; failure → `BATCH_STATUS_HOLD`; 100% sampling for flagged/endangered/export, statistical otherwise.
**Integration point.** Extends the existing `quality_test` path and GACP state machine; new pure functions alongside `mpr.ts` (mirror its unit-tested style).
**Failure/edge.** Any metric over limit → fail; DNA mismatch → fail + flag; missing barcode on a required batch → hold.
**Security.** Lab result must be dual-endorsed (reuse the incentive-independent verifier rule).
**Honest tag.** **BUILT** — pure enforcement functions with tests (this is the most credible B item; do it first).
**Verify.** Pass + fail unit test per rule; sampling-ratio logic tested against conservation status.

## 7. Real IoT Weighbridge + RFID (CP-3 hardware)
**Purpose.** Replace the simulated weigh with a real scale feed; auto-log custody via RFID.
**Input.** MQTT weight messages; RFID tag reads.
**Output.** `AggregationRequest` weigh (declared vs measured, ±10%); custody events.
**Integration point.** `/events/aggregation`; reuses `WEIGHT_VARIANCE_HOLD`.
**Dependencies.** An MQTT broker + scale; RFID reader.
**Failure/edge.** Variance >10% → hold + inspection; sensor dropout → last-known + flag.
**Honest tag.** MQTT subscriber + mock publisher → **SIMULATED**; real hardware → **DESIGNED**.
**Verify.** Subscriber tested against a mock publisher; variance logic unit-tested.

## 8. Full PoLK (Proof-of-Local-Knowledge)
**Purpose.** Community corroboration of a lone collector's claim beyond the scripted 2-peer demo.
**Input.** Cluster membership, collection claim (species+qty), peer CONFIRM/DISPUTE responses.
**Output.** `polkStatus` = CONFIRMED / UNCONFIRMED / DISPUTED; UNCONFIRMED caps GACP until later corroboration; DISPUTE → PENDING + CFA within 48h.
**Integration point.** Feeds the collection event's PoLK metadata + GACP score; no new endpoints.
**Failure/edge.** No response in 4h → commits UNCONFIRMED (not silent auto-accept), score capped; whole-cluster collusion is a known limit (DNA at CP-6 is the backstop) — state it honestly.
**Security.** Anonymize peer prompts; rate-limit; can't defend coordinated cluster fraud (by design — say so).
**Honest tag.** Quorum + dispute/timeout state machine → **BUILT**; SMS fan-out → **SIMULATED** until Twilio.
**Verify.** Unit-test quorum, timeout→UNCONFIRMED, dispute→PENDING transitions.
