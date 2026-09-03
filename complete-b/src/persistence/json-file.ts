/**
 * Tiny JSON-file persistence utility (Node built-ins only).
 *
 * HONESTY TAG: 🟢 BUILT — synchronous read/write with atomic replace (write temp + rename) so
 * a crash mid-write can't corrupt the store. Suitable for the dev/single-node scale Complete-B
 * targets; a real datastore implements the same store interfaces at scale.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function readJsonFile<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback;
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFile(path: string, data: unknown): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, path); // atomic on the same filesystem
}
