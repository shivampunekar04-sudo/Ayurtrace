import { describe, it, expect } from 'vitest';
import {
  evaluatePolk,
  capGacpScore,
  buildPeerPrompt,
  NoopPeerNotifier,
  DEFAULT_POLK_POLICY,
  HOUR_MS,
  type PolkClaim,
  type PolkPeerVote,
} from '../src/polk/polk.js';

const T0 = 1_700_000_000_000; // fixed epoch for deterministic timeouts

const claim = (over: Partial<PolkClaim> = {}): PolkClaim => ({
  collectorId: 'NMPB-COL-KA-8823',
  cluster: 'CLUSTER-TUMKUR-04',
  speciesCode: 'ASWG',
  quantityKg: 45,
  localityLabel: 'Tumakuru belt (Zone 7)',
  openedAtMs: T0,
  ...over,
});

const vote = (peerId: string, response: 'CONFIRM' | 'DISPUTE', atMs = T0 + 60_000): PolkPeerVote => ({
  peerId,
  response,
  respondedAtMs: atMs,
});

describe('PoLK quorum', () => {
  it('CONFIRMS once the confirm quorum is met', () => {
    const r = evaluatePolk(claim(), [vote('p1', 'CONFIRM'), vote('p2', 'CONFIRM')], T0 + HOUR_MS);
    expect(r.workflow).toBe('CONFIRMED');
    expect(r.attestation.status).toBe('CONFIRMED');
    expect(r.attestation.confirmations).toBe(2);
    expect(r.attestation.disputes).toBe(0);
    expect(r.gacpScoreCap).toBe(Number.POSITIVE_INFINITY);
  });

  it('stays OPEN inside the window when quorum is not yet reached', () => {
    const r = evaluatePolk(claim(), [vote('p1', 'CONFIRM')], T0 + HOUR_MS);
    expect(r.workflow).toBe('OPEN');
    expect(r.attestation.status).toBe('UNCONFIRMED');
    expect(r.timedOut).toBe(false);
  });
});

describe('PoLK timeout', () => {
  it('commits UNCONFIRMED (not silent accept) when the window elapses without quorum', () => {
    const r = evaluatePolk(claim(), [vote('p1', 'CONFIRM')], T0 + 5 * HOUR_MS);
    expect(r.workflow).toBe('UNCONFIRMED');
    expect(r.attestation.status).toBe('UNCONFIRMED');
    expect(r.timedOut).toBe(true);
    expect(r.gacpScoreCap).toBe(DEFAULT_POLK_POLICY.unconfirmedScoreCap);
  });

  it('UNCONFIRMED with zero responses at timeout', () => {
    const r = evaluatePolk(claim(), [], T0 + 5 * HOUR_MS);
    expect(r.attestation.status).toBe('UNCONFIRMED');
    expect(r.confirmations).toBe(0);
  });

  it('can be upgraded to CONFIRMED by later corroboration even after timeout', () => {
    const late = [vote('p1', 'CONFIRM', T0 + 6 * HOUR_MS), vote('p2', 'CONFIRM', T0 + 7 * HOUR_MS)];
    const r = evaluatePolk(claim(), late, T0 + 8 * HOUR_MS);
    expect(r.workflow).toBe('CONFIRMED');
  });
});

describe('PoLK dispute', () => {
  it('escalates to DISPUTED + CFA deadline on a dispute', () => {
    const r = evaluatePolk(claim(), [vote('p1', 'DISPUTE')], T0 + HOUR_MS);
    expect(r.workflow).toBe('DISPUTED_PENDING_CFA');
    expect(r.attestation.status).toBe('DISPUTED');
    expect(r.cfaReviewDeadlineMs).toBe(T0 + DEFAULT_POLK_POLICY.cfaReviewWindowMs);
    expect(r.gacpScoreCap).toBe(DEFAULT_POLK_POLICY.disputedScoreCap);
  });

  it('a dispute wins even when confirmations also reached quorum (safety precedence)', () => {
    const votes = [vote('p1', 'CONFIRM'), vote('p2', 'CONFIRM'), vote('p3', 'DISPUTE')];
    const r = evaluatePolk(claim(), votes, T0 + HOUR_MS);
    expect(r.attestation.status).toBe('DISPUTED');
    expect(r.confirmations).toBe(2);
    expect(r.disputes).toBe(1);
  });
});

describe('PoLK vote integrity', () => {
  it('dedupes a peer voting many times (last vote wins) to blunt ballot-stuffing', () => {
    const votes = [
      vote('p1', 'CONFIRM', T0 + 1),
      vote('p1', 'CONFIRM', T0 + 2),
      vote('p1', 'DISPUTE', T0 + 3), // p1 changed their mind; only this counts
      vote('p2', 'CONFIRM'),
    ];
    const r = evaluatePolk(claim(), votes, T0 + HOUR_MS);
    expect(r.disputes).toBe(1); // from p1's latest
    expect(r.confirmations).toBe(1); // only p2
    expect(r.attestation.status).toBe('DISPUTED');
  });

  it('ignores a self-vote by the collector', () => {
    const votes = [vote('NMPB-COL-KA-8823', 'CONFIRM'), vote('p1', 'CONFIRM'), vote('p2', 'CONFIRM')];
    const r = evaluatePolk(claim(), votes, T0 + HOUR_MS);
    expect(r.confirmations).toBe(2);
    expect(r.notes.some((n) => n.includes('self-vote'))).toBe(true);
  });
});

describe('PoLK GACP cap + prompt', () => {
  it('caps a raw score for UNCONFIRMED and leaves CONFIRMED uncapped', () => {
    const unconfirmed = evaluatePolk(claim(), [], T0 + 5 * HOUR_MS);
    expect(capGacpScore(95, unconfirmed)).toBe(60);
    const confirmed = evaluatePolk(claim(), [vote('p1', 'CONFIRM'), vote('p2', 'CONFIRM')], T0 + HOUR_MS);
    expect(capGacpScore(95, confirmed)).toBe(95);
  });

  it('anonymizes the peer prompt — never names the collector', () => {
    const c = claim();
    const prompt = buildPeerPrompt(c);
    expect(prompt).not.toContain(c.collectorId);
    expect(prompt).toContain('ASWG');
    expect(prompt).toMatch(/CONFIRM or DISPUTE/);
  });

  it('NoopPeerNotifier records sends without a real transport', async () => {
    const n = new NoopPeerNotifier();
    await n.send('p1', 'hello');
    expect(n.sent).toEqual([{ peerId: 'p1', message: 'hello' }]);
  });
});
