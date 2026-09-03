/**
 * PoLK session orchestrator (component 8 — operational layer).
 *
 * HONESTY TAG: 🟢 BUILT — turns the pure `evaluatePolk` state machine into a running service:
 * it opens sessions, fans prompts out, records votes as they arrive, and (via `tick`) fires the
 * response-window → UNCONFIRMED and dispute → CFA transitions. Deterministic — the caller drives
 * time through `tick(nowMs)`, so timeouts are testable without wall-clock timers. Wire `tick` to
 * a real interval/cron in production.
 *
 * Persistence is pluggable via `PolkSessionStore` (in-memory here; a file adapter lives in
 * src/persistence/). SMS fan-out is pluggable via `PolkPeerNotifier` (Noop or Twilio-backed).
 */
import {
  buildPeerPrompt,
  DEFAULT_POLK_POLICY,
  evaluatePolk,
  type PolkClaim,
  type PolkEvaluation,
  type PolkPeerNotifier,
  type PolkPeerVote,
  type PolkPolicy,
} from './polk.js';

type PolkAttestation = PolkEvaluation['attestation'];

export interface PolkSession {
  id: string;
  claim: PolkClaim;
  peerIds: string[];
  votes: PolkPeerVote[];
  /** last committed workflow state (for change detection across ticks). */
  committed?: PolkEvaluation['workflow'];
}

export interface PolkSessionStore {
  get(id: string): PolkSession | undefined;
  put(session: PolkSession): void;
  delete(id: string): void;
  all(): PolkSession[];
}

export class InMemoryPolkSessionStore implements PolkSessionStore {
  private readonly map = new Map<string, PolkSession>();
  get(id: string) {
    return this.map.get(id);
  }
  put(session: PolkSession) {
    this.map.set(session.id, session);
  }
  delete(id: string) {
    this.map.delete(id);
  }
  all() {
    return [...this.map.values()];
  }
}

export interface PolkTransition {
  sessionId: string;
  workflow: PolkEvaluation['workflow'];
  attestation: PolkAttestation;
  evaluation: PolkEvaluation;
  /** true when the committed workflow changed on this tick. */
  changed: boolean;
}

export class PolkSessionManager {
  constructor(
    private readonly store: PolkSessionStore,
    private readonly policy: PolkPolicy = DEFAULT_POLK_POLICY,
  ) {}

  /** Open a session and fan the anonymized prompt out to peers (if a notifier is given). */
  async openSession(
    id: string,
    claim: PolkClaim,
    peerIds: string[],
    notifier?: PolkPeerNotifier,
  ): Promise<PolkSession> {
    const session: PolkSession = { id, claim, peerIds, votes: [] };
    this.store.put(session);
    if (notifier) {
      const prompt = buildPeerPrompt(claim);
      for (const peerId of peerIds) {
        try {
          await notifier.send(peerId, prompt);
        } catch {
          /* delivery failure never aborts — PoLK degrades to UNCONFIRMED on missing votes */
        }
      }
    }
    return session;
  }

  /** Record a peer's vote. Unknown session → no-op returns false. */
  recordVote(id: string, vote: PolkPeerVote): boolean {
    const session = this.store.get(id);
    if (!session) return false;
    session.votes.push(vote);
    this.store.put(session);
    return true;
  }

  /** Evaluate a single session at `nowMs` without mutating committed state. */
  evaluate(id: string, nowMs: number): PolkEvaluation | undefined {
    const session = this.store.get(id);
    if (!session) return undefined;
    return evaluatePolk(session.claim, session.votes, nowMs, this.policy);
  }

  /**
   * Advance all sessions to `nowMs`, committing terminal/UNCONFIRMED states. Returns the
   * sessions whose committed workflow CHANGED on this tick (e.g. OPEN → UNCONFIRMED at timeout,
   * OPEN → CONFIRMED on quorum, → DISPUTED_PENDING_CFA on a dispute, UNCONFIRMED → CONFIRMED on
   * later corroboration). CONFIRMED and DISPUTED are terminal and are not re-emitted.
   */
  tick(nowMs: number): PolkTransition[] {
    const transitions: PolkTransition[] = [];
    for (const session of this.store.all()) {
      // Terminal states never change again.
      if (session.committed === 'CONFIRMED' || session.committed === 'DISPUTED_PENDING_CFA') continue;
      const evaluation = evaluatePolk(session.claim, session.votes, nowMs, this.policy);
      const changed = evaluation.workflow !== session.committed;
      if (changed) {
        session.committed = evaluation.workflow;
        this.store.put(session);
        transitions.push({
          sessionId: session.id,
          workflow: evaluation.workflow,
          attestation: evaluation.attestation,
          evaluation,
          changed: true,
        });
      }
    }
    return transitions;
  }
}
