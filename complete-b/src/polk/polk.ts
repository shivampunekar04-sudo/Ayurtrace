/**
 * Full PoLK — Proof-of-Local-Knowledge (component 8).
 *
 * HONESTY TAG: 🟢 BUILT for the quorum + dispute/timeout state machine and the
 * anonymized-prompt builder (pure, unit-tested). 🟡 SIMULATED for the peer fan-out
 * transport (SMS/USSD) — see `NoopPeerNotifier`; a real Twilio/USSD sender drops in
 * behind the `PolkPeerNotifier` interface without touching the state machine.
 *
 * What PoLK does (solution §2B / spec §8): a lone collector's claim is corroborated by
 * anonymized cluster peers. Their CONFIRM/DISPUTE votes drive a status that feeds the
 * collection event's PoLK metadata and caps the GACP score until corroborated.
 *
 * Contract discipline: the on-chain projection is the FROZEN `PolkAttestation`
 * (`epcis.ts`) — exactly `status: 'CONFIRMED' | 'UNCONFIRMED' | 'DISPUTED'` plus
 * `confirmations` / `disputes`. The richer workflow states (OPEN, and the 48h CFA
 * review after a dispute) live OFF the attestation, in Complete-B's own model. No
 * contract field is added.
 *
 * Honest limitation (stated, not hidden): PoLK cannot defend a whole-cluster collusion
 * (every peer confirms a false claim). DNA identity at CP-6 is the designed backstop.
 */
import type { PolkAttestation } from '../../contracts/index.js';

export type PeerResponse = 'CONFIRM' | 'DISPUTE';

/** One peer's vote. Peers are deduped by id (last vote wins) to blunt ballot-stuffing. */
export interface PolkPeerVote {
  /** Anonymized cluster-peer id. */
  peerId: string;
  response: PeerResponse;
  respondedAtMs: number;
}

export interface PolkClaim {
  collectorId: string;
  cluster: string;
  speciesCode: string;
  quantityKg: number;
  /** Approximate locality shown to peers (zone/village), never precise GPS. */
  localityLabel: string;
  /** When peer prompts were fanned out (epoch ms). */
  openedAtMs: number;
}

export interface PolkPolicy {
  /** Confirmations required to reach CONFIRMED. */
  confirmQuorum: number;
  /** Disputes required to escalate to DISPUTED (default 1: any genuine dispute escalates). */
  disputeThreshold: number;
  /** Response window; past it, an unconfirmed claim commits UNCONFIRMED (never silently accepted). */
  responseWindowMs: number;
  /** Time a CFA has to review a disputed claim. */
  cfaReviewWindowMs: number;
  /** GACP score ceiling while UNCONFIRMED. */
  unconfirmedScoreCap: number;
  /** GACP score ceiling while DISPUTED (pending CFA). */
  disputedScoreCap: number;
}

export const HOUR_MS = 3_600_000;

export const DEFAULT_POLK_POLICY: PolkPolicy = {
  confirmQuorum: 2,
  disputeThreshold: 1,
  responseWindowMs: 4 * HOUR_MS,
  cfaReviewWindowMs: 48 * HOUR_MS,
  unconfirmedScoreCap: 60,
  disputedScoreCap: 0,
};

/**
 * Workflow state — Complete-B's internal view, richer than the on-chain attestation.
 * OPEN and DISPUTED_PENDING_CFA both project onto frozen attestation statuses below.
 */
export type PolkWorkflowState =
  | 'OPEN' // window still open, quorum not yet reached, no dispute
  | 'CONFIRMED'
  | 'UNCONFIRMED' // window elapsed without quorum (upgradable on later corroboration)
  | 'DISPUTED_PENDING_CFA';

export interface PolkEvaluation {
  workflow: PolkWorkflowState;
  /** The exact frozen shape to attach to the collection event's `polk` field. */
  attestation: PolkAttestation;
  confirmations: number;
  disputes: number;
  quorumReached: boolean;
  timedOut: boolean;
  /** Ceiling to apply to the GACP score (Infinity = no cap). */
  gacpScoreCap: number;
  /** Deadline for CFA review, present only when DISPUTED_PENDING_CFA. */
  cfaReviewDeadlineMs?: number;
  notes: string[];
}

/**
 * Deduplicate votes by peer (last vote wins) and drop any self-vote by the collector.
 * Returns confirmation/dispute counts over the *distinct* eligible peers.
 */
function tallyVotes(
  claim: PolkClaim,
  votes: PolkPeerVote[],
): { confirmations: number; disputes: number; ignoredSelfVotes: number } {
  const latestByPeer = new Map<string, PolkPeerVote>();
  let ignoredSelfVotes = 0;
  for (const v of votes) {
    if (v.peerId === claim.collectorId) {
      ignoredSelfVotes++;
      continue;
    }
    const prev = latestByPeer.get(v.peerId);
    if (!prev || v.respondedAtMs >= prev.respondedAtMs) {
      latestByPeer.set(v.peerId, v);
    }
  }
  let confirmations = 0;
  let disputes = 0;
  for (const v of latestByPeer.values()) {
    if (v.response === 'CONFIRM') confirmations++;
    else disputes++;
  }
  return { confirmations, disputes, ignoredSelfVotes };
}

const attest = (
  status: PolkAttestation['status'],
  confirmations: number,
  disputes: number,
): PolkAttestation => ({ status, confirmations, disputes });

/**
 * Evaluate a PoLK session at time `nowMs`.
 *
 * Precedence (safety first):
 *   1. A dispute at/over threshold → DISPUTED (needs CFA within the review window),
 *      even if confirmations also reached quorum — a flagged claim gets a human.
 *   2. Confirmations at/over quorum → CONFIRMED.
 *   3. Otherwise UNCONFIRMED — OPEN if still inside the window, timed-out past it.
 *      Both commit UNCONFIRMED (never a silent accept) and can be upgraded later.
 */
export function evaluatePolk(
  claim: PolkClaim,
  votes: PolkPeerVote[],
  nowMs: number,
  policy: PolkPolicy = DEFAULT_POLK_POLICY,
): PolkEvaluation {
  const { confirmations, disputes, ignoredSelfVotes } = tallyVotes(claim, votes);
  const timedOut = nowMs >= claim.openedAtMs + policy.responseWindowMs;
  const quorumReached = confirmations >= policy.confirmQuorum;

  const notes: string[] = [];
  if (ignoredSelfVotes > 0) notes.push(`Ignored ${ignoredSelfVotes} self-vote(s) by the collector.`);

  // 1. Dispute escalation wins.
  if (disputes >= policy.disputeThreshold) {
    notes.push('Dispute raised — escalated to CFA review; whole-cluster collusion is not defended here (CP-6 DNA is the backstop).');
    return {
      workflow: 'DISPUTED_PENDING_CFA',
      attestation: attest('DISPUTED', confirmations, disputes),
      confirmations,
      disputes,
      quorumReached,
      timedOut,
      gacpScoreCap: policy.disputedScoreCap,
      cfaReviewDeadlineMs: claim.openedAtMs + policy.cfaReviewWindowMs,
      notes,
    };
  }

  // 2. Confirmed by quorum.
  if (quorumReached) {
    return {
      workflow: 'CONFIRMED',
      attestation: attest('CONFIRMED', confirmations, disputes),
      confirmations,
      disputes,
      quorumReached,
      timedOut,
      gacpScoreCap: Number.POSITIVE_INFINITY,
      notes,
    };
  }

  // 3. Not enough confirms, no dispute.
  if (timedOut) {
    notes.push('Response window elapsed without quorum — committed UNCONFIRMED (not auto-accepted); upgradable on later corroboration.');
  } else {
    notes.push('Awaiting peer responses within the window — provisional UNCONFIRMED.');
  }
  return {
    workflow: timedOut ? 'UNCONFIRMED' : 'OPEN',
    attestation: attest('UNCONFIRMED', confirmations, disputes),
    confirmations,
    disputes,
    quorumReached,
    timedOut,
    gacpScoreCap: policy.unconfirmedScoreCap,
    notes,
  };
}

/** Apply the PoLK GACP ceiling to a raw score. */
export function capGacpScore(rawScore: number, evaluation: PolkEvaluation): number {
  return Math.min(rawScore, evaluation.gacpScoreCap);
}

/**
 * Build the anonymized peer prompt. SECURITY: the prompt must NOT reveal the
 * collector's identity — only species, approximate quantity, and locality label.
 * (Delivery is SIMULATED; this builder is pure and tested.)
 */
export function buildPeerPrompt(claim: PolkClaim): string {
  const qty = Math.round(claim.quantityKg);
  return (
    `AyurTrace: did a registered collector in your cluster harvest about ${qty} kg ` +
    `of ${claim.speciesCode} near ${claim.localityLabel} today? ` +
    `Reply CONFIRM or DISPUTE.`
  );
}

/**
 * Transport for fanning peer prompts out. 🟡 SIMULATED — a real Twilio/USSD sender
 * implements this interface; the state machine above never depends on the transport.
 */
export interface PolkPeerNotifier {
  send(peerId: string, message: string): Promise<void>;
}

/** No-op notifier for development/tests: records nothing, sends nothing real. */
export class NoopPeerNotifier implements PolkPeerNotifier {
  readonly sent: { peerId: string; message: string }[] = [];
  async send(peerId: string, message: string): Promise<void> {
    this.sent.push({ peerId, message });
  }
}

export interface PolkFanOutResult {
  prompt: string;
  delivered: string[];
  failed: { peerId: string; error: string }[];
}

/**
 * Fan the anonymized prompt out to every cluster peer via the injected notifier. The
 * prompt is built once (never names the collector) and reused for all peers. A failure to
 * reach one peer never aborts the others — PoLK degrades to UNCONFIRMED on missing votes,
 * it does not fail the collection.
 */
export async function fanOutPrompts(
  claim: PolkClaim,
  peerIds: string[],
  notifier: PolkPeerNotifier,
): Promise<PolkFanOutResult> {
  const prompt = buildPeerPrompt(claim);
  const delivered: string[] = [];
  const failed: { peerId: string; error: string }[] = [];
  for (const peerId of peerIds) {
    try {
      await notifier.send(peerId, prompt);
      delivered.push(peerId);
    } catch (err) {
      failed.push({ peerId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { prompt, delivered, failed };
}
