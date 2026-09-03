import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileIdempotencyStore,
  FilePolkSessionStore,
  FileAnchorStore,
  loadFileConsentStore,
} from '../src/persistence/file-stores.js';
import { CFA_COLLECTION_PURPOSE } from '../src/cfa/intake.js';

const dirs: string[] = [];
function tmpFile(name: string): string {
  const d = mkdtempSync(join(tmpdir(), 'ayurtrace-'));
  dirs.push(d);
  return join(d, name);
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('FileIdempotencyStore', () => {
  it('persists across instances', () => {
    const path = tmpFile('idem.json');
    const a = new FileIdempotencyStore(path);
    a.remember('SM1', { to: '+1', text: 'ok', outcome: 'COMMITTED' });
    const b = new FileIdempotencyStore(path); // reload from disk
    expect(b.seen('SM1')).toBe(true);
    expect(b.get('SM1')?.text).toBe('ok');
  });
});

describe('FilePolkSessionStore', () => {
  it('persists sessions and votes across instances', () => {
    const path = tmpFile('polk.json');
    const a = new FilePolkSessionStore(path);
    a.put({ id: 's1', claim: { collectorId: 'C', cluster: 'K', speciesCode: 'ASWG', quantityKg: 1, localityLabel: 'x', openedAtMs: 0 }, peerIds: ['p1'], votes: [{ peerId: 'p1', response: 'CONFIRM', respondedAtMs: 1 }] });
    const b = new FilePolkSessionStore(path);
    expect(b.get('s1')?.votes).toHaveLength(1);
  });
});

describe('FileAnchorStore', () => {
  it('persists anchors and reports pending across instances', () => {
    const path = tmpFile('anchors.json');
    const a = new FileAnchorStore(path);
    a.put({ hashHex: 'abc', hashAlgorithm: 'sha256', status: 'PENDING', attempts: 1 });
    const b = new FileAnchorStore(path);
    expect(b.pending().map((x) => x.hashHex)).toEqual(['abc']);
  });
});

describe('FileConsentStore', () => {
  it('persists grants and honours erasure on disk (no biometric hash survives)', () => {
    const path = tmpFile('consent.json');
    const s1 = loadFileConsentStore(path);
    s1.grant({ id: 'c1', collectorId: 'COL', cfaId: 'CFA', purpose: CFA_COLLECTION_PURPOSE, atMs: 1, biometricHash: 'h', biometricSalt: 's' });
    const s2 = loadFileConsentStore(path);
    expect(s2.hasActiveConsent('COL', 'CFA', CFA_COLLECTION_PURPOSE)).toBe(true);
    s2.erase('COL', 'CFA', CFA_COLLECTION_PURPOSE, 2);
    const s3 = loadFileConsentStore(path);
    const rec = s3.get('COL', 'CFA', CFA_COLLECTION_PURPOSE);
    expect(rec?.status).toBe('ERASED');
    expect(rec?.biometricHash).toBeUndefined();
  });
});
