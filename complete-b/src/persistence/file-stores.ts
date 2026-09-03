/**
 * File-backed implementations of Complete-B's pluggable store interfaces.
 *
 * HONESTY TAG: 🟢 BUILT — durable adapters behind the SAME interfaces the in-memory stores
 * implement, so any component can persist by swapping the constructor. Backed by atomic JSON
 * files (src/persistence/json-file.ts). A production datastore implements the same interfaces.
 */
import { ConsentStore, type ConsentRecord } from '../cfa/consent.js';
import type { IdempotencyStore, SmsReply } from '../sms/gateway.js';
import type { PolkSession, PolkSessionStore } from '../polk/session.js';
import type { AnchorStore } from '../rfc3161/anchor-store.js';
import type { TimestampAnchor } from '../rfc3161/rfc3161.js';
import { readJsonFile, writeJsonFile } from './json-file.js';

/** SMS idempotency store persisted to a JSON file. */
export class FileIdempotencyStore implements IdempotencyStore {
  private readonly map: Map<string, SmsReply>;
  constructor(private readonly path: string) {
    this.map = new Map(Object.entries(readJsonFile<Record<string, SmsReply>>(path, {})));
  }
  private flush() {
    writeJsonFile(this.path, Object.fromEntries(this.map));
  }
  seen(sid: string) {
    return this.map.has(sid);
  }
  remember(sid: string, reply: SmsReply) {
    this.map.set(sid, reply);
    this.flush();
  }
  get(sid: string) {
    return this.map.get(sid);
  }
}

/** PoLK session store persisted to a JSON file. */
export class FilePolkSessionStore implements PolkSessionStore {
  private readonly map: Map<string, PolkSession>;
  constructor(private readonly path: string) {
    const arr = readJsonFile<PolkSession[]>(path, []);
    this.map = new Map(arr.map((s) => [s.id, s]));
  }
  private flush() {
    writeJsonFile(this.path, [...this.map.values()]);
  }
  get(id: string) {
    return this.map.get(id);
  }
  put(session: PolkSession) {
    this.map.set(session.id, session);
    this.flush();
  }
  delete(id: string) {
    this.map.delete(id);
    this.flush();
  }
  all() {
    return [...this.map.values()];
  }
}

/** RFC-3161 anchor store persisted to a JSON file. */
export class FileAnchorStore implements AnchorStore {
  private readonly map: Map<string, TimestampAnchor>;
  constructor(private readonly path: string) {
    const arr = readJsonFile<TimestampAnchor[]>(path, []);
    this.map = new Map(arr.map((a) => [a.hashHex, a]));
  }
  private flush() {
    writeJsonFile(this.path, [...this.map.values()]);
  }
  get(hashHex: string) {
    return this.map.get(hashHex);
  }
  put(anchor: TimestampAnchor) {
    this.map.set(anchor.hashHex, anchor);
    this.flush();
  }
  all() {
    return [...this.map.values()];
  }
  pending() {
    return this.all().filter((a) => a.status === 'PENDING');
  }
}

/**
 * A ConsentStore that persists to a JSON file. DPDP note: this stores salted biometric HASHES
 * only (never raw templates), and erasure clears them — so the on-disk file honours the
 * right-to-erasure just like the in-memory store.
 */
export function loadFileConsentStore(path: string): ConsentStore {
  const store = new ConsentStore({ onChange: (records) => writeJsonFile(path, records) });
  store.restore(readJsonFile<ConsentRecord[]>(path, []));
  return store;
}
