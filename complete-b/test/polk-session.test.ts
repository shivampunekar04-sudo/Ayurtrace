import { describe, it, expect } from 'vitest';
import {
  PolkSessionManager,
  InMemoryPolkSessionStore,
} from '../src/polk/session.js';
import { NoopPeerNotifier, HOUR_MS, type PolkClaim } from '../src/polk/polk.js';

const T0 = 1_712_000_000_000;
const claim = (): PolkClaim => ({
  collectorId: 'NMPB-COL-KA-8823',
  cluster: 'CLUSTER-TUMKUR-04',
  speciesCode: 'ASWG',
  quantityKg: 45,
  localityLabel: 'Tumakuru belt',
  openedAtMs: T0,
});

function manager() {
  return new PolkSessionManager(new InMemoryPolkSessionStore());
}

describe('PoLK session manager', () => {
  it('fans prompts out to peers on open', async () => {
    const mgr = manager();
    const notifier = new NoopPeerNotifier();
    await mgr.openSession('s1', claim(), ['p1', 'p2', 'p3'], notifier);
    expect(notifier.sent).toHaveLength(3);
  });

  it('commits CONFIRMED once quorum votes are recorded', async () => {
    const mgr = manager();
    await mgr.openSession('s1', claim(), ['p1', 'p2']);
    mgr.recordVote('s1', { peerId: 'p1', response: 'CONFIRM', respondedAtMs: T0 + 1000 });
    mgr.recordVote('s1', { peerId: 'p2', response: 'CONFIRM', respondedAtMs: T0 + 2000 });
    const t = mgr.tick(T0 + HOUR_MS);
    expect(t).toHaveLength(1);
    expect(t[0]!.workflow).toBe('CONFIRMED');
    expect(t[0]!.attestation.status).toBe('CONFIRMED');
  });

  it('stays OPEN inside the window, then commits UNCONFIRMED at timeout', async () => {
    const mgr = manager();
    await mgr.openSession('s1', claim(), ['p1', 'p2']);
    // Inside window, no quorum → OPEN (a change from undefined → OPEN is emitted once).
    const early = mgr.tick(T0 + HOUR_MS);
    expect(early[0]!.workflow).toBe('OPEN');
    // No further change while still open.
    expect(mgr.tick(T0 + 2 * HOUR_MS)).toHaveLength(0);
    // Past the 4h window → UNCONFIRMED.
    const late = mgr.tick(T0 + 5 * HOUR_MS);
    expect(late[0]!.workflow).toBe('UNCONFIRMED');
    expect(late[0]!.attestation.status).toBe('UNCONFIRMED');
  });

  it('upgrades UNCONFIRMED → CONFIRMED on later corroboration', async () => {
    const mgr = manager();
    await mgr.openSession('s1', claim(), ['p1', 'p2']);
    mgr.tick(T0 + 5 * HOUR_MS); // UNCONFIRMED
    mgr.recordVote('s1', { peerId: 'p1', response: 'CONFIRM', respondedAtMs: T0 + 6 * HOUR_MS });
    mgr.recordVote('s1', { peerId: 'p2', response: 'CONFIRM', respondedAtMs: T0 + 7 * HOUR_MS });
    const up = mgr.tick(T0 + 8 * HOUR_MS);
    expect(up[0]!.workflow).toBe('CONFIRMED');
  });

  it('commits DISPUTED (terminal) on a dispute and stops re-emitting', async () => {
    const mgr = manager();
    await mgr.openSession('s1', claim(), ['p1', 'p2']);
    mgr.recordVote('s1', { peerId: 'p1', response: 'DISPUTE', respondedAtMs: T0 + 1000 });
    const t = mgr.tick(T0 + HOUR_MS);
    expect(t[0]!.workflow).toBe('DISPUTED_PENDING_CFA');
    expect(t[0]!.evaluation.cfaReviewDeadlineMs).toBeDefined();
    // Terminal — no further transitions even if more votes arrive.
    mgr.recordVote('s1', { peerId: 'p2', response: 'CONFIRM', respondedAtMs: T0 + 2000 });
    expect(mgr.tick(T0 + 2 * HOUR_MS)).toHaveLength(0);
  });

  it('recordVote on an unknown session returns false', () => {
    expect(manager().recordVote('ghost', { peerId: 'p', response: 'CONFIRM', respondedAtMs: T0 })).toBe(false);
  });
});
