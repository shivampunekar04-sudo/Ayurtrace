import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import {
  parseTwilioInbound,
  toTwiml,
  TwilioSmsSender,
  createSmsWebhookServer,
} from '../src/sms/twilio.js';
import {
  InMemoryDirectory,
  InMemoryIdempotencyStore,
  WindowRateLimiter,
  type CollectionSubmitter,
  type SmsGatewayDeps,
} from '../src/sms/gateway.js';

describe('Twilio inbound parsing', () => {
  it('parses a urlencoded Twilio webhook body', () => {
    const form = 'From=%2B919000000001&Body=HERB+ASWG+45+13.34%2C77.10+NMPB-COL-KA-8823&MessageSid=SM123';
    const inbound = parseTwilioInbound(form);
    expect(inbound.from).toBe('+919000000001');
    expect(inbound.body).toBe('HERB ASWG 45 13.34,77.10 NMPB-COL-KA-8823');
    expect(inbound.messageSid).toBe('SM123');
  });
});

describe('TwiML rendering', () => {
  it('wraps the reply text and escapes XML', () => {
    const xml = toTwiml({ to: '+1', text: 'Rejected: zone & <bad>', outcome: 'REJECTED' });
    expect(xml).toContain('<Response><Message>');
    expect(xml).toContain('zone &amp; &lt;bad&gt;');
  });
});

describe('TwilioSmsSender configuration', () => {
  it('reports unconfigured and refuses to send without credentials', async () => {
    const sender = new TwilioSmsSender({ accountSid: '', authToken: '', from: '' });
    expect(sender.isConfigured()).toBe(false);
    await expect(sender.send('+1', 'hi')).rejects.toThrow(/not configured/);
  });
});

// ---- local webhook round-trip (no Twilio account) ---------------------------

const okSubmitter: CollectionSubmitter = {
  async submit() {
    return { ok: true, data: { epc: 'urn:ayurtrace:lot:CE-KA-ASWG-2026-000007', txId: 'tx1', gacpScore: 40 } };
  },
};

function deps(): SmsGatewayDeps {
  return {
    directory: new InMemoryDirectory({ '+919000000001': 'NMPB-COL-KA-8823' }),
    submitter: okSubmitter,
    idempotency: new InMemoryIdempotencyStore(),
    rateLimiter: new WindowRateLimiter(),
  };
}

describe('SMS webhook server (local, no Twilio)', () => {
  let server: ReturnType<typeof createSmsWebhookServer> | undefined;
  afterEach(() => server?.close());

  it('accepts a POSTed inbound SMS and returns committing TwiML', async () => {
    server = createSmsWebhookServer(deps());
    await new Promise<void>((r) => server!.listen(0, r));
    const port = (server.address() as AddressInfo).port;

    const form = new URLSearchParams({
      From: '+919000000001',
      Body: 'HERB ASWG 45 13.34,77.10 NMPB-COL-KA-8823',
      MessageSid: 'SM-webhook-1',
    });
    const res = await fetch(`http://127.0.0.1:${port}/sms`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('xml');
    const xml = await res.text();
    expect(xml).toContain('<Message>');
    expect(xml).toContain('CE-KA-ASWG-2026-000007');
  });

  it('404s a non-webhook path', async () => {
    server = createSmsWebhookServer(deps());
    await new Promise<void>((r) => server!.listen(0, r));
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/other`, { method: 'POST', body: '' });
    expect(res.status).toBe(404);
  });
});
