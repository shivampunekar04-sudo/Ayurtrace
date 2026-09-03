/**
 * Biometric handling for Tier-4 CFA intake (component 2).
 *
 * HONESTY TAG: 🟢 BUILT for the salted-hash storage + verify (never stores the raw
 * template — DPDP requirement). 🔵 DESIGNED for the protection SCHEME: HMAC-SHA256 with a
 * per-record salt is a placeholder for a real biometric template-protection scheme
 * (fuzzy vault / cancelable biometrics). 🟡 SIMULATED for capture — `SimulatedCapture`
 * stands in for a fingerprint SDK/device.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** A captured biometric template (opaque bytes as hex). Never persisted raw. */
export type BiometricTemplate = string;

export interface StoredBiometric {
  hash: string;
  salt: string;
}

/** Hash a template with a fresh salt (enrolment). */
export function enrolBiometric(template: BiometricTemplate, salt: string = randomBytes(16).toString('hex')): StoredBiometric {
  return { hash: hashBiometric(template, salt), salt };
}

/** Deterministic salted hash of a template. */
export function hashBiometric(template: BiometricTemplate, salt: string): string {
  return createHmac('sha256', salt).update(template).digest('hex');
}

/** Constant-time verify of a candidate template against a stored salted hash. */
export function verifyBiometric(candidate: BiometricTemplate, stored: StoredBiometric): boolean {
  const candHash = Buffer.from(hashBiometric(candidate, stored.salt), 'hex');
  const storedHash = Buffer.from(stored.hash, 'hex');
  if (candHash.length !== storedHash.length) return false;
  return timingSafeEqual(candHash, storedHash);
}

/** Capture interface a real fingerprint SDK/device implements. */
export interface BiometricCapture {
  capture(): Promise<BiometricTemplate>;
}

/** 🟡 SIMULATED capture: returns a preset template (device stand-in for dev/tests). */
export class SimulatedCapture implements BiometricCapture {
  constructor(private readonly template: BiometricTemplate) {}
  async capture(): Promise<BiometricTemplate> {
    return this.template;
  }
}
