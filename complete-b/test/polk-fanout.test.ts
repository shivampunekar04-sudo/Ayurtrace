import { describe, it, expect } from 'vitest';
import { fanOutPrompts, NoopPeerNotifier, type PolkClaim, type PolkPeerNotifier } from '../src/polk/polk.js';
import { SmsSenderPeerNotifier } from '../src/sms/twilio.js';
import type { SmsSender } from '../src/sms/twilio.js';

const claim: PolkClaim = {
  collectorId: 'NMPB-COL-KA-8823',
  cluster: 'CLUSTER-TUMKUR-04',
  speciesCode: 'ASWG',
  quantityKg: 45,
  localityLabel: 'Tumakuru belt',
  openedAtMs: 1_712_000_000_000,
};

describe('PoLK fan-out', () => {
  it('sends one anonymized prompt to every peer', async () => {
    const notifier = new NoopPeerNotifier();
    const res = await fanOutPrompts(claim, ['p1', 'p2', 'p3'], notifier);
    expect(res.delivered).toEqual(['p1', 'p2', 'p3']);
    expect(res.failed).toEqual([]);
    expect(notifier.sent).toHaveLength(3);
    // Anonymized: the prompt never names the collector.
    for (const s of notifier.sent) expect(s.message).not.toContain(claim.collectorId);
  });

  it('one peer failing does not abort the rest', async () => {
    const flaky: PolkPeerNotifier = {
      async send(peerId) {
        if (peerId === 'p2') throw new Error('unreachable');
      },
    };
    const res = await fanOutPrompts(claim, ['p1', 'p2', 'p3'], flaky);
    expect(res.delivered).toEqual(['p1', 'p3']);
    expect(res.failed).toEqual([{ peerId: 'p2', error: 'unreachable' }]);
  });

  it('SmsSenderPeerNotifier resolves peers to phone numbers and sends', async () => {
    const sent: { to: string; body: string }[] = [];
    const sender: SmsSender = {
      async send(to, body) {
        sent.push({ to, body });
      },
    };
    const phones: Record<string, string> = { p1: '+919000000011', p2: '+919000000012' };
    const notifier = new SmsSenderPeerNotifier(sender, (id) => phones[id] ?? null);
    const res = await fanOutPrompts(claim, ['p1', 'p2'], notifier);
    expect(res.delivered).toEqual(['p1', 'p2']);
    expect(sent.map((s) => s.to)).toEqual(['+919000000011', '+919000000012']);
  });

  it('SmsSenderPeerNotifier records a failure for an unknown peer', async () => {
    const sender: SmsSender = { async send() {} };
    const notifier = new SmsSenderPeerNotifier(sender, () => null);
    const res = await fanOutPrompts(claim, ['ghost'], notifier);
    expect(res.failed[0]?.peerId).toBe('ghost');
  });
});
