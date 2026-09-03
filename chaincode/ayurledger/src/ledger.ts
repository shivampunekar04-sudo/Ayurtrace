/**
 * LedgerPort — the seam between enforcement logic and the state store.
 *
 * Fabric's ChaincodeStub satisfies this in production (contract.ts adapts it);
 * MemoryLedger satisfies it for unit tests and the local demo golden path.
 * This is a clean-architecture port, NOT a replacement for Fabric: Fabric stays
 * the primary implementation. The in-memory adapter is explicitly a dev/demo
 * fallback (execution plan §2 already contemplates a single-org fallback).
 */

export interface StateKV {
  key: string;
  value: string;
}

export interface LedgerPort {
  getState(key: string): Promise<string | undefined>;
  putState(key: string, value: string): Promise<void>;
  deleteState(key: string): Promise<void>;
  /** composite key made from an objectType and its attributes, colon-delimited. */
  createCompositeKey(objectType: string, attributes: string[]): string;
  /** all KVs whose composite key starts with objectType + given attribute prefix. */
  getByPartialCompositeKey(
    objectType: string,
    attributes: string[],
  ): Promise<StateKV[]>;
  /** deterministic tx id for event provenance. */
  txId(): string;
  /** deterministic timestamp (ISO) — in Fabric, from the tx proposal. */
  txTimestampIso(): string;
}

const SEP = '\u0000'; // Fabric composite-key delimiter (min-unicode)

/** In-memory ledger — deterministic, ordered, dependency-free. */
export class MemoryLedger implements LedgerPort {
  private readonly state = new Map<string, string>();
  private seq = 0;
  private clockIso: string;

  constructor(startIso = '2026-04-15T06:47:00+05:30') {
    this.clockIso = startIso;
  }

  /** advance the deterministic clock (demo/test control). */
  setClock(iso: string): void {
    this.clockIso = iso;
  }

  async getState(key: string): Promise<string | undefined> {
    return this.state.get(key);
  }
  async putState(key: string, value: string): Promise<void> {
    this.state.set(key, value);
  }
  async deleteState(key: string): Promise<void> {
    this.state.delete(key);
  }
  createCompositeKey(objectType: string, attributes: string[]): string {
    return SEP + objectType + SEP + attributes.join(SEP) + SEP;
  }
  async getByPartialCompositeKey(
    objectType: string,
    attributes: string[],
  ): Promise<StateKV[]> {
    const prefix = SEP + objectType + SEP + attributes.join(SEP);
    const out: StateKV[] = [];
    for (const [key, value] of this.state) {
      if (key.startsWith(prefix)) out.push({ key, value });
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  txId(): string {
    this.seq += 1;
    return '0x' + this.seq.toString(16).padStart(12, '0');
  }
  txTimestampIso(): string {
    return this.clockIso;
  }

  /** test/demo helper: raw snapshot. */
  dump(): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    for (const [k, v] of this.state) o[k.replace(/\u0000/g, '|')] = JSON.parse(v);
    return o;
  }
}
