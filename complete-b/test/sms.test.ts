import { describe, it, expect } from 'vitest';
import { parseHerbSms } from '../src/sms/parser.js';
import { defaultPlantPart, resolveSeason } from '../src/sms/enrichment.js';
import {
  handleInboundSms,
  InMemoryDirectory,
  InMemoryIdempotencyStore,
  WindowRateLimiter,
  type CollectionSubmitter,
  type InboundSms,
  type SmsGatewayDeps,
} from '../src/sms/gateway.js';
import { RejectCode, type ApiResult, type CollectionResponse } from '../contracts/index.js';

describe('SMS parser', () => {
  it('parses the canonical format', () => {
    const r = parseHerbSms('HERB ASWG 45 13.34,77.10 NMPB-COL-KA-8823');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        speciesCode: 'ASWG',
        quantityKg: 45,
        lat: 13.34,
        lon: 77.1,
        collectorId: 'NMPB-COL-KA-8823',
      });
      expect(r.value.plantPart).toBeUndefined();
    }
  });

  it('parses the optional PART token', () => {
    const r = parseHerbSms('HERB ASWG 45 ROOT 13.34,77.10 NMPB-COL-KA-8823');
    expect(r.ok && r.value.plantPart).toBe('ROOT');
  });

  it('is case-insensitive on the keyword and species', () => {
    const r = parseHerbSms('herb aswg 45 13.34,77.10 NMPB-COL-KA-8823');
    expect(r.ok && r.value.speciesCode).toBe('ASWG');
  });

  it.each([
    ['', 'EMPTY'],
    ['HELLO there', 'BAD_KEYWORD'],
    ['HERB ASWG', 'TOO_FEW_TOKENS'],
    ['HERB ASWG notanumber 13.34,77.10 COL', 'BAD_QUANTITY'],
    ['HERB ASWG 45 999,999 COL', 'BAD_LATLON'],
    ['HERB ASWG 45 nocomma COL', 'BAD_LATLON'],
  ])('rejects %j with %s and returns help', (input, code) => {
    const r = parseHerbSms(input);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe(code);
      expect(r.help).toMatch(/Format: HERB/);
    }
  });
});

describe('SMS enrichment', () => {
  it('defaults the plant part per species', () => {
    expect(defaultPlantPart('ASWG')).toBe('ROOT');
    expect(defaultPlantPart('unknown')).toBe('WHOLE');
  });
  it('resolves seasons by month', () => {
    expect(resolveSeason(new Date('2026-01-15'))).toBe('RABI');
    expect(resolveSeason(new Date('2026-07-15'))).toBe('KHARIF');
    expect(resolveSeason(new Date('2026-04-15'))).toBe('ZAID');
  });
});

// ---- handler ----------------------------------------------------------------

const okSubmitter = (data: CollectionResponse): CollectionSubmitter => ({
  async submit() {
    return { ok: true, data } satisfies ApiResult<CollectionResponse>;
  },
});

const rejectSubmitter = (code: RejectCode): CollectionSubmitter => ({
  async submit() {
    return { ok: false, code, message: 'x' } satisfies ApiResult<CollectionResponse>;
  },
});

const baseDeps = (submitter: CollectionSubmitter): SmsGatewayDeps => ({
  directory: new InMemoryDirectory({ '+919000000001': 'NMPB-COL-KA-8823' }),
  submitter,
  idempotency: new InMemoryIdempotencyStore(),
  rateLimiter: new WindowRateLimiter(5, 60_000),
});

const sms = (over: Partial<InboundSms> = {}): InboundSms => ({
  from: '+919000000001',
  body: 'HERB ASWG 45 13.34,77.10 NMPB-COL-KA-8823',
  messageSid: 'SM1',
  receivedAt: new Date('2026-01-15T06:47:00+05:30'),
  ...over,
});

describe('SMS gateway handler', () => {
  it('commits a valid message and replies with the batch id + tx', async () => {
    const deps = baseDeps(okSubmitter({ epc: 'urn:ayurtrace:lot:CE-KA-ASWG-2026-000007', txId: 'tx-abc', gacpScore: 40 }));
    const r = await handleInboundSms(sms(), deps);
    expect(r.outcome).toBe('COMMITTED');
    expect(r.text).toContain('CE-KA-ASWG-2026-000007');
    expect(r.text).toContain('tx-abc');
  });

  it('maps a typed reject code to REJECT_MESSAGES copy', async () => {
    const deps = baseDeps(rejectSubmitter(RejectCode.ZONE_VIOLATION));
    const r = await handleInboundSms(sms(), deps);
    expect(r.outcome).toBe('REJECTED');
    expect(r.text).toContain('approved collection zone');
  });

  it('rejects an unregistered sender number', async () => {
    const deps = baseDeps(okSubmitter({ epc: 'e', txId: 't', gacpScore: 1 }));
    const r = await handleInboundSms(sms({ from: '+910000000000' }), deps);
    expect(r.outcome).toBe('UNREGISTERED');
  });

  it('rejects when the message collector id does not match the sender registration', async () => {
    const deps = baseDeps(okSubmitter({ epc: 'e', txId: 't', gacpScore: 1 }));
    const r = await handleInboundSms(sms({ body: 'HERB ASWG 45 13.34,77.10 NMPB-COL-KA-9999' }), deps);
    expect(r.outcome).toBe('UNREGISTERED');
  });

  it('returns help on a malformed body', async () => {
    const deps = baseDeps(okSubmitter({ epc: 'e', txId: 't', gacpScore: 1 }));
    const r = await handleInboundSms(sms({ body: 'HERB ASWG' }), deps);
    expect(r.outcome).toBe('PARSE_ERROR');
    expect(r.text).toMatch(/Format: HERB/);
  });

  it('is idempotent on message SID (SMS retries do not double-submit)', async () => {
    let submits = 0;
    const counting: CollectionSubmitter = {
      async submit() {
        submits++;
        return { ok: true, data: { epc: 'e', txId: 't', gacpScore: 1 } };
      },
    };
    const deps = baseDeps(counting);
    const first = await handleInboundSms(sms(), deps);
    const retry = await handleInboundSms(sms(), deps); // same SID
    expect(submits).toBe(1);
    expect(retry.text).toBe(first.text);
  });

  it('rate-limits a flooding sender', async () => {
    const deps = baseDeps(okSubmitter({ epc: 'e', txId: 't', gacpScore: 1 }));
    for (let i = 0; i < 5; i++) {
      const r = await handleInboundSms(sms({ messageSid: `SM${i}` }), deps);
      expect(r.outcome).toBe('COMMITTED');
    }
    const sixth = await handleInboundSms(sms({ messageSid: 'SM-flood' }), deps);
    expect(sixth.outcome).toBe('RATE_LIMITED');
  });

  it('surfaces a transport failure as ERROR without throwing', async () => {
    const boom: CollectionSubmitter = {
      async submit() {
        throw new Error('network down');
      },
    };
    const r = await handleInboundSms(sms(), baseDeps(boom));
    expect(r.outcome).toBe('ERROR');
  });

  it('sets entryMethod TIER3_SMS and enriches season + part', async () => {
    let captured: unknown;
    const capturing: CollectionSubmitter = {
      async submit(req) {
        captured = req;
        return { ok: true, data: { epc: 'e', txId: 't', gacpScore: 1 } };
      },
    };
    await handleInboundSms(sms(), baseDeps(capturing));
    expect(captured).toMatchObject({
      entryMethod: 'TIER3_SMS',
      season: 'RABI',
      plantPart: 'ROOT',
      location: { lat: 13.34, lon: 77.1, altitudeM: 0 },
    });
  });
});
