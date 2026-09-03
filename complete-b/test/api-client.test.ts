import { describe, it, expect } from 'vitest';
import { AyurTraceClient, collectionSubmitterFrom, type FetchLike } from '../src/client/api-client.js';

interface Call {
  url: string;
  method: string;
  body?: unknown;
}

function stubFetch(response: unknown, calls: Call[]): FetchLike {
  return async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return { ok: true, status: 200, json: async () => response };
  };
}

const collectionReq = {
  speciesCode: 'ASWG',
  quantityKg: 45,
  plantPart: 'ROOT',
  collectorId: 'NMPB-COL-KA-8823',
  season: 'RABI',
  location: { lat: 13.34, lon: 77.1, altitudeM: 0 },
  entryMethod: 'TIER3_SMS' as const,
};

describe('AyurTraceClient endpoint wiring', () => {
  it('POSTs collection to the frozen path and returns the typed envelope', async () => {
    const calls: Call[] = [];
    const client = new AyurTraceClient({
      baseUrl: 'http://gw:3001',
      fetchImpl: stubFetch({ ok: true, data: { epc: 'e', txId: 't', gacpScore: 40 } }, calls),
    });
    const r = await client.collection(collectionReq);
    expect(calls[0]).toMatchObject({ url: 'http://gw:3001/events/collection', method: 'POST' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.epc).toBe('e');
  });

  it('encodes the epc path segment for batch reads', async () => {
    const calls: Call[] = [];
    const client = new AyurTraceClient({ baseUrl: 'http://gw', fetchImpl: stubFetch({ ok: true, data: {} }, calls) });
    await client.batch('urn:ayurtrace:lot:CE-KA-ASWG-2026-000007');
    expect(calls[0]!.url).toBe('http://gw/batch/urn%3Aayurtrace%3Alot%3ACE-KA-ASWG-2026-000007');
  });

  it('builds zones, quota, recall and qr-verify paths', async () => {
    const calls: Call[] = [];
    const client = new AyurTraceClient({ baseUrl: 'http://gw', fetchImpl: stubFetch({ ok: true, data: {} }, calls) });
    await client.zones();
    await client.zoneQuota('NMPB-KA-ZONE-07');
    await client.recall('urn:x');
    await client.qrVerify('SER-1');
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET http://gw/zones',
      'GET http://gw/zones/NMPB-KA-ZONE-07/quota',
      'POST http://gw/recall/urn%3Ax',
      'GET http://gw/qr/SER-1/verify',
    ]);
  });

  it('surfaces a typed reject envelope unchanged', async () => {
    const client = new AyurTraceClient({
      baseUrl: 'http://gw',
      fetchImpl: stubFetch({ ok: false, code: 'ZONE_VIOLATION', message: 'x' }, []),
    });
    const r = await client.collection(collectionReq);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ZONE_VIOLATION');
  });

  it('strips a trailing slash from the base URL', () => {
    expect(new AyurTraceClient({ baseUrl: 'http://gw/' }).baseUrl).toBe('http://gw');
  });

  it('ping returns false when the gateway is unreachable', async () => {
    const client = new AyurTraceClient({
      baseUrl: 'http://gw',
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    expect(await client.ping()).toBe(false);
  });

  it('collectionSubmitterFrom adapts the client to the SMS gateway interface', async () => {
    const client = new AyurTraceClient({
      baseUrl: 'http://gw',
      fetchImpl: stubFetch({ ok: true, data: { epc: 'e', txId: 't', gacpScore: 1 } }, []),
    });
    const submitter = collectionSubmitterFrom(client);
    const r = await submitter.submit(collectionReq);
    expect(r.ok).toBe(true);
  });
});
