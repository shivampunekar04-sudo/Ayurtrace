/**
 * Twilio outbound smoke test (Tier-3 SMS / PoLK fan-out transport).
 *
 * Proves the already-coded TwilioSmsSender goes live once credentials exist — no
 * code change needed. Reads creds from the environment or a local .env (gitignored);
 * only sends when both the Twilio creds AND a TEST_SMS_TO recipient are set, so
 * running it without creds is safe and just reports status.
 *
 *   npm run build            # emit dist/
 *   # put TWILIO_* and TEST_SMS_TO in complete-b/.env (see .env.example), then:
 *   node scripts/sms-test.mjs
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// --- tiny .env loader (no dependency) ---
for (const f of ['.env', path.resolve(fileURLToPath(import.meta.url), '../../.env'), path.resolve(fileURLToPath(import.meta.url), '../../../.env')]) {
  try {
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const s = line.trim();
      if (!s || s.startsWith('#')) continue;
      const i = s.indexOf('=');
      if (i < 0) continue;
      const k = s.slice(0, i).trim();
      let v = s.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      if (k && process.env[k] === undefined) process.env[k] = v;
    }
  } catch { /* no .env here */ }
}

const { TwilioSmsSender } = await import('../dist/src/sms/twilio.js');
const sender = new TwilioSmsSender();

console.log('Twilio configured:', sender.isConfigured());
if (!sender.isConfigured()) {
  console.log('→ Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER (see .env.example).');
  console.log('  SMS stays SIMULATED until then — the code is ready, it just needs the account.');
  process.exit(0);
}

const to = process.env.TEST_SMS_TO;
if (!to) {
  console.log('Credentials present, but no TEST_SMS_TO recipient set — not sending.');
  console.log('→ Set TEST_SMS_TO=+91XXXXXXXXXX and re-run to send a real test SMS.');
  process.exit(0);
}

console.log(`Sending a live test SMS to ${to} …`);
try {
  await sender.send(to, 'AyurTrace: Tier-3 SMS is live. HERB ASWG 12 13.34,77.10 NMPB-COL-KA-8823');
  console.log('✓ Sent. Twilio integration is LIVE.');
} catch (e) {
  console.error('✗ Send failed:', e?.message ?? e);
  process.exit(1);
}
