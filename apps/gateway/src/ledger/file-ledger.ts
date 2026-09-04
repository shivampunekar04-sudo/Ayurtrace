/**
 * FileLedger — a durable LedgerPort for the `live` product demo.
 *
 * It runs the SAME AyurLedgerService enforcement code as the chaincode and the
 * in-memory demo, but it persists every committed write to a JSON file and uses
 * a real wall-clock timestamp. So when a judge enters a collection, mixes a lot,
 * or mints a QR, the data is real, timestamped now, and still there after a
 * restart — the behaviour of a deployed product, not a scripted mock.
 *
 * It is NOT a substitute for Hyperledger Fabric: Fabric remains the production
 * ledger (FabricLedgerBackend). This adapter exists so the product is fully
 * usable, live, and persistent on one machine without Docker.
 */
import { promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import type { LedgerPort, StateKV } from 'ayurledger/ledger';

// Fabric composite-key delimiter (U+0000). Any consistent delimiter works here
// because FileLedger only ever reads back its own keys; U+0000 matches MemoryLedger.
const SEP = String.fromCharCode(0);

interface Snapshot {
  version: 1;
  state: [string, string][];
  seq: number;
}

export class FileLedger implements LedgerPort {
  private readonly state = new Map<string, string>();
  private seq = 0;
  private loaded = false;

  constructor(private readonly file: string) {}

  /** Load persisted state (once). Returns true when an existing ledger was found. */
  async load(): Promise<boolean> {
    if (this.loaded) return this.state.size > 0;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const snap = JSON.parse(raw) as Snapshot;
      this.state.clear();
      for (const [k, v] of snap.state) this.state.set(k, v);
      this.seq = snap.seq ?? 0;
      return this.state.size > 0;
    } catch {
      return false; // no file yet → caller will seed
    }
  }

  /** Atomically persist the current state (temp file + rename). */
  async flush(): Promise<void> {
    const snap: Snapshot = { version: 1, state: [...this.state.entries()], seq: this.seq };
    const dir = path.dirname(this.file);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.file}.${randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(snap), 'utf8');
    await fs.rename(tmp, this.file);
  }

  /** Re-read committed state from disk, discarding uncommitted in-memory writes. */
  async reload(): Promise<void> {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const snap = JSON.parse(raw) as Snapshot;
      this.state.clear();
      for (const [k, v] of snap.state) this.state.set(k, v);
      this.seq = snap.seq ?? 0;
    } catch {
      // no committed file yet — nothing to roll back to
    }
  }

  /** Wipe all state (for a fresh re-seed). */
  clear(): void {
    this.state.clear();
    this.seq = 0;
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
  async getByPartialCompositeKey(objectType: string, attributes: string[]): Promise<StateKV[]> {
    const prefix = SEP + objectType + SEP + attributes.join(SEP);
    const out: StateKV[] = [];
    for (const [key, value] of this.state) {
      if (key.startsWith(prefix)) out.push({ key, value });
    }
    return out.sort((a, b) => (a.key < b.key ? -1 : 1));
  }
  txId(): string {
    this.seq += 1;
    return '0x' + randomBytes(6).toString('hex') + this.seq.toString(16).padStart(4, '0');
  }
  txTimestampIso(): string {
    return new Date().toISOString();
  }
}
