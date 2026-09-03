# Integration — pointing Complete-B at a real ledger

Complete-B reaches a ledger only through the frozen §6.4 surface, via one config value and one
unified client. There is no Complete-A source dependency in any mode.

## One knob

- `src/config/config.ts` → `CONFIG.apiBaseUrl`, overridable with the env var
  **`AYURTRACE_API_BASE_URL`**. Default: `http://localhost:3001` (the bundled mock).
- Every component uses the unified [`AyurTraceClient`](../src/client/api-client.ts), which covers
  all §6.4 endpoints from the frozen `ENDPOINTS` map and returns typed `ApiResult<T>`.

```ts
import { AyurTraceClient } from 'ayurtrace-complete-b';

const client = new AyurTraceClient(); // uses AYURTRACE_API_BASE_URL or the mock
if (!(await client.ping())) throw new Error('gateway unreachable');
const res = await client.collection(req);   // typed Ok | Rejected
```

The SMS gateway can submit through the same client:

```ts
import { collectionSubmitterFrom } from 'ayurtrace-complete-b';
const deps = { /* … */, submitter: collectionSubmitterFrom(client) };
```

## Three modes (in order of independence)

1. **B demos on the mock (default).**
   ```bash
   npm run mock                       # http://localhost:3001
   npm run smoke                      # real B code hits it end-to-end
   ```
2. **B points at a live, contract-compatible gateway.** One env var — no code change:
   ```bash
   AYURTRACE_API_BASE_URL="https://gateway.example.org" npm run smoke
   ```
3. **B runs its own ledger.** The chaincode + gateway are contract-defined and shareable; stand up
   an instance and set `AYURTRACE_API_BASE_URL` to it. Fully independent of A. (Requires Docker +
   Fabric on your machine — 🔵 DESIGNED here, verified where you run it.)

## Going live on the SIMULATED edges

| Edge | Ready-to-wire | What you supply |
|------|---------------|-----------------|
| RFC-3161 TSA | ✅ **proven live + signature-verified** (`npm run tsa:live` verifies a real DigiCert token's CMS signature) | a preferred TSA URL, and a pinned trust anchor for full chain verification |
| Twilio SMS | `TwilioSmsSender` + `createSmsWebhookServer` built & locally tested | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, and point the number's inbound webhook at `/sms` |
| Fabric CA (RBAC) | policy matrix + attribute middleware built | a running Fabric CA/MSP per org to enforce live |
| MQTT weighbridge | subscriber + mock broker built | a real broker + scale + RFID reader |

RFC-3161 is genuinely live: the DER request builder, real-token CMS parsing, imprint
verification, **and full CMS signature verification** all work against DigiCert's public
timestamp authority (no account needed). The only remaining 🔵 piece is pinning the TSA
certificate to a trusted root — the signature and the cert's validity window are verified;
chain-to-anchor needs a trust store you supply.
