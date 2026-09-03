/**
 * Twilio transport adapter for the Tier-3 SMS gateway (component 1).
 *
 * HONESTY TAG:
 *   🟢 BUILT — inbound webhook parsing, TwiML reply rendering, and the local HTTP webhook
 *     server are pure/wire-testable and covered by tests (no Twilio account needed to test).
 *   🟡 SIMULATED — the last mile: a real Twilio phone number pointing its inbound webhook at
 *     this server, and `TwilioSmsSender` calling Twilio's REST API. That needs the account
 *     credentials below; until they are set and a number is wired, this stays SIMULATED.
 *
 * Required env for live outbound (never hard-coded; asked of the operator, not assumed):
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 * The inbound webhook needs no secret to parse, but SHOULD be protected by Twilio request
 * signature validation in production (X-Twilio-Signature) — flagged, not implemented here.
 */
import http from 'node:http';
import { handleInboundSms, type InboundSms, type SmsGatewayDeps, type SmsReply } from './gateway.js';
import type { PolkPeerNotifier } from '../polk/polk.js';

/** Parse a Twilio inbound webhook body (application/x-www-form-urlencoded) into InboundSms. */
export function parseTwilioInbound(formBody: string): InboundSms {
  const p = new URLSearchParams(formBody);
  return {
    from: p.get('From') ?? '',
    body: p.get('Body') ?? '',
    messageSid: p.get('MessageSid') ?? p.get('SmsSid') ?? '',
    receivedAt: new Date(),
  };
}

const xmlEscape = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/** Render a reply as TwiML the Twilio webhook expects. */
export function toTwiml(reply: SmsReply): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(reply.text)}</Message></Response>`;
}

/** Outbound SMS transport (for PoLK fan-out, proactive replies, etc.). */
export interface SmsSender {
  send(to: string, body: string): Promise<void>;
}

/** 🟡 SIMULATED-until-configured Twilio REST sender. */
export class TwilioSmsSender implements SmsSender {
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly from: string;
  constructor(config?: { accountSid?: string; authToken?: string; from?: string }) {
    this.accountSid = config?.accountSid ?? process.env.TWILIO_ACCOUNT_SID ?? '';
    this.authToken = config?.authToken ?? process.env.TWILIO_AUTH_TOKEN ?? '';
    this.from = config?.from ?? process.env.TWILIO_FROM_NUMBER ?? '';
  }
  isConfigured(): boolean {
    return Boolean(this.accountSid && this.authToken && this.from);
  }
  async send(to: string, body: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new Error('TwilioSmsSender is not configured (set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER).');
    }
    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');
    const form = new URLSearchParams({ To: to, From: this.from, Body: body });
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    if (!res.ok) throw new Error(`Twilio REST error HTTP ${res.status}`);
  }
}

/**
 * Adapts an `SmsSender` into a PoLK `PolkPeerNotifier`, resolving each anonymized peer id to
 * a phone number. This is what makes PoLK fan-out real over SMS — 🟢 BUILT adapter, 🟡
 * SIMULATED end-to-end until the underlying `SmsSender` (e.g. `TwilioSmsSender`) is configured.
 */
export class SmsSenderPeerNotifier implements PolkPeerNotifier {
  constructor(
    private readonly sender: SmsSender,
    private readonly resolvePhone: (peerId: string) => string | null,
  ) {}
  async send(peerId: string, message: string): Promise<void> {
    const phone = this.resolvePhone(peerId);
    if (!phone) throw new Error(`No phone number for peer ${peerId}`);
    await this.sender.send(phone, message);
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => resolve(b));
  });
}

/**
 * Create the inbound-SMS webhook server. A real Twilio number's "A message comes in" webhook
 * points here (POST). It runs the full handler and returns TwiML. Locally testable without
 * Twilio by POSTing a form body.
 */
export function createSmsWebhookServer(deps: SmsGatewayDeps, path = '/sms'): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method !== 'POST' || (req.url ?? '').split('?')[0] !== path) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const body = await readBody(req);
    const inbound = parseTwilioInbound(body);
    const reply = await handleInboundSms(inbound, deps);
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end(toTwiml(reply));
  });
}
