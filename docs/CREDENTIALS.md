# Getting Twilio + IPFS live (item #3)

The code for both is already written and env-gated — no code change is needed to go
live. You create the accounts (that part must be you, for security), drop the tokens in a
local `.env` (gitignored), and the mock paths flip to real. Copy [`.env.example`](../.env.example)
to `.env` and fill it in.

## IPFS (real, resolvable lab-certificate links)

1. Sign up at **https://pinata.cloud** (free tier is plenty).
2. **API Keys → New Key** → give it pinning permission → copy the **JWT**.
3. Put it in `apps/gateway/.env`:
   ```
   PINATA_JWT=eyJ...your-jwt...
   ```
4. Restart the gateway: `cd apps/gateway && npm run build && npm run start:live`.
5. Verify: `GET http://localhost:3001/ipfs/status` → `{"live":true,"provider":"pinata"}`.
6. In the **operator dashboard → Lab test**, attach a certificate file. It is pinned to
   IPFS and the **real CID** is anchored on-chain; the consumer app's certificate link
   now resolves at a public IPFS gateway.

*(Alternative: set `WEB3_STORAGE_TOKEN` instead of `PINATA_JWT` to use web3.storage.)*

## Twilio (real Tier-3 SMS + PoLK fan-out)

1. Sign up at **https://twilio.com/try-twilio** (trial includes credit).
2. From the **Console**: copy **Account SID** and **Auth Token**; buy/get a **phone number**.
3. Put them in `complete-b/.env` (and your own phone as the test recipient):
   ```
   TWILIO_ACCOUNT_SID=ACxxxxxxxx
   TWILIO_AUTH_TOKEN=xxxxxxxx
   TWILIO_FROM_NUMBER=+1XXXXXXXXXX
   TEST_SMS_TO=+91XXXXXXXXXX
   ```
4. Send a real test message:
   ```
   cd complete-b && npm run sms:test
   ```
   → `✓ Sent. Twilio integration is LIVE.`

**Inbound** (a collector texting `HERB ASWG 12 13.34,77.10 <colId>`): point your Twilio
number's "A message comes in" webhook at a public URL that reaches
`createSmsWebhookServer` (in `complete-b/src/sms/twilio.ts`). For a local demo, expose it
with a tunnel (e.g. ngrok) and set the webhook to `https://<tunnel>/sms`.

## Security

- Never paste tokens into chat or commit them. `.env` is gitignored; only `.env.example`
  (with blank values) is committed.
- Twilio trial numbers can only text **verified** recipients until the account is upgraded.
