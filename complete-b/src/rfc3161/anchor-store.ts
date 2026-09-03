/**
 * RFC-3161 anchor store + retry loop (component 3 — operational layer).
 *
 * HONESTY TAG: 🟢 BUILT — makes the fail-open design actually complete: PENDING anchors are
 * persisted and re-driven until they ANCHOR or exhaust attempts. Deterministic + tested.
 *
 * `anchorTimestamp` already never blocks the ledger; this layer remembers the PENDING anchors
 * and `retryPendingAnchors` re-attempts them (wire it to an interval/cron). Persistence is
 * pluggable via `AnchorStore` (in-memory here; a file adapter lives in src/persistence/).
 */
import { anchorTimestamp, type TimestampAnchor, type TsaClient } from './rfc3161.js';

export interface AnchorStore {
  get(hashHex: string): TimestampAnchor | undefined;
  put(anchor: TimestampAnchor): void;
  all(): TimestampAnchor[];
  pending(): TimestampAnchor[];
}

export class InMemoryAnchorStore implements AnchorStore {
  private readonly map = new Map<string, TimestampAnchor>();
  get(hashHex: string) {
    return this.map.get(hashHex);
  }
  put(anchor: TimestampAnchor) {
    this.map.set(anchor.hashHex, anchor);
  }
  all() {
    return [...this.map.values()];
  }
  pending() {
    return this.all().filter((a) => a.status === 'PENDING');
  }
}

export interface RetryOptions {
  /** Give up (leave PENDING but stop retrying) after this many attempts. Default 5. */
  maxAttempts?: number;
}

/** Anchor a hash and remember the result (ANCHORED or PENDING) in the store. */
export async function anchorAndStore(
  store: AnchorStore,
  client: TsaClient,
  opts: { hashHex: string; hashAlgorithm?: 'sha256' | 'sha1' | 'sha512'; nonce?: bigint; tsaUrl?: string },
): Promise<TimestampAnchor> {
  const anchor = await anchorTimestamp(client, opts);
  store.put(anchor);
  return anchor;
}

export interface RetryOutcome {
  attempted: number;
  anchored: number;
  stillPending: number;
  exhausted: number;
}

/**
 * Re-drive every PENDING anchor once. ANCHORED anchors are updated in the store; ones that
 * exhaust `maxAttempts` are left PENDING but skipped on subsequent runs.
 */
export async function retryPendingAnchors(
  store: AnchorStore,
  client: TsaClient,
  options: RetryOptions = {},
): Promise<RetryOutcome> {
  const maxAttempts = options.maxAttempts ?? 5;
  const outcome: RetryOutcome = { attempted: 0, anchored: 0, stillPending: 0, exhausted: 0 };

  for (const anchor of store.pending()) {
    if (anchor.attempts >= maxAttempts) {
      outcome.exhausted++;
      continue;
    }
    outcome.attempted++;
    const retried = await anchorTimestamp(client, {
      hashHex: anchor.hashHex,
      hashAlgorithm: anchor.hashAlgorithm,
      attempts: anchor.attempts,
      ...(anchor.tsaUrl ? { tsaUrl: anchor.tsaUrl } : {}),
    });
    store.put(retried);
    if (retried.status === 'ANCHORED') outcome.anchored++;
    else if (retried.attempts >= maxAttempts) outcome.exhausted++;
    else outcome.stillPending++;
  }
  return outcome;
}
