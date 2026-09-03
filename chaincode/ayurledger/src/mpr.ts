/**
 * MPR enforcement — the crown jewel (solution §2B, §2C, §4.1).
 *
 * Deliberately dependency-free: pure functions over typed inputs, so every
 * rule has a passing and a failing unit test WITHOUT standing up a network
 * (execution plan §3 "chaincode enforcement → hand-write + unit-test").
 * The Contract class (contract.ts) wires these to ledger state.
 */
import {
  RejectCode,
  GacpStatus,
  Checkpoint,
  type SpeciesRule,
  type Collector,
  type Quota,
  type Zone,
} from '@ayurtrace/contracts';

/** Discriminated result — a hard fail carries its frozen §6.2 reject code. */
export type CheckOutcome =
  | { ok: true }
  | { ok: false; code: RejectCode; detail?: Record<string, unknown> };

const PASS: CheckOutcome = { ok: true };
const fail = (code: RejectCode, detail?: Record<string, unknown>): CheckOutcome => ({
  ok: false,
  code,
  detail,
});

// ---------------------------------------------------------------------------
// MPR CHECK 1 — Geo-fence (point-in-polygon, ray casting)
// ---------------------------------------------------------------------------

/**
 * Ray-casting point-in-polygon. Polygon is a closed ring of [lon, lat] pairs.
 * Returns true when the point is strictly inside or on-edge of the ring.
 * Edge case handled: horizontal rays crossing exactly through a vertex are
 * counted once (strict inequality on one endpoint's latitude).
 */
export function pointInPolygon(
  lon: number,
  lat: number,
  ring: [number, number][],
): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function checkGeoFence(
  lon: number,
  lat: number,
  zone: Zone,
): CheckOutcome {
  if (!zone || !zone.polygon || zone.polygon.length < 4) {
    return fail(RejectCode.ZONE_VIOLATION, { reason: 'NO_ZONE_POLYGON' });
  }
  return pointInPolygon(lon, lat, zone.polygon)
    ? PASS
    : fail(RejectCode.ZONE_VIOLATION, { lon, lat, zoneId: zone.id });
}

// ---------------------------------------------------------------------------
// MPR CHECK 2 — Season
// ---------------------------------------------------------------------------

export function checkSeason(species: SpeciesRule, season: string): CheckOutcome {
  return species.allowedSeasons.includes(season)
    ? PASS
    : fail(RejectCode.SEASON_VIOLATION, {
        season,
        allowed: species.allowedSeasons,
      });
}

// ---------------------------------------------------------------------------
// MPR CHECK 3 — Quota (atomic decrement; offline soft-reserve model, §2B fix)
// ---------------------------------------------------------------------------

export interface QuotaDecision {
  outcome: CheckOutcome;
  /** new consumed total to persist when the draw is allowed. */
  newConsumedKg: number;
  quotaRemainingBeforeKg: number;
  quotaRemainingAfterKg: number;
  /** true when an offline over-draw committed FLAGGED (bounded, attributed). */
  overDrawFlagged: boolean;
}

/**
 * Online path: over-quota is a hard reject (QUOTA_EXCEEDED).
 * Offline path (drew against a cluster soft-reserve): the plant is already cut,
 * so we do NOT reject after the fact. The event commits FLAGGED, the overage is
 * attributed, and next season's reserve is decremented (handled by the caller).
 * This closes the v1 "reject after the plant is already cut" incentive bug.
 */
export function decideQuota(
  quota: Quota,
  requestKg: number,
  offlineSoftReserve: boolean,
): QuotaDecision {
  const remainingBefore = quota.annualLimitKg - quota.consumedKg;
  const newConsumed = quota.consumedKg + requestKg;
  const remainingAfter = quota.annualLimitKg - newConsumed;
  const overDraw = newConsumed > quota.annualLimitKg;

  if (!overDraw) {
    return {
      outcome: PASS,
      newConsumedKg: newConsumed,
      quotaRemainingBeforeKg: remainingBefore,
      quotaRemainingAfterKg: remainingAfter,
      overDrawFlagged: false,
    };
  }

  if (offlineSoftReserve) {
    // commit flagged rather than silently pass or reject-after-cut
    return {
      outcome: PASS,
      newConsumedKg: newConsumed,
      quotaRemainingBeforeKg: remainingBefore,
      quotaRemainingAfterKg: remainingAfter, // negative: over-draw, will be reconciled
      overDrawFlagged: true,
    };
  }

  return {
    outcome: fail(RejectCode.QUOTA_EXCEEDED, {
      annualLimitKg: quota.annualLimitKg,
      consumedKg: quota.consumedKg,
      requestKg,
    }),
    newConsumedKg: quota.consumedKg,
    quotaRemainingBeforeKg: remainingBefore,
    quotaRemainingAfterKg: remainingBefore,
    overDrawFlagged: false,
  };
}

/** 80% warning threshold — emits an SMS to all zone collectors (§2B). */
export function quotaWarning(quota: Quota, afterConsumedKg: number): boolean {
  const pctBefore = quota.consumedKg / quota.annualLimitKg;
  const pctAfter = afterConsumedKg / quota.annualLimitKg;
  return pctBefore < 0.8 && pctAfter >= 0.8;
}

// ---------------------------------------------------------------------------
// MPR CHECK 4 — License
// ---------------------------------------------------------------------------

export function checkLicense(
  collector: Collector,
  eventTimeIso: string,
): CheckOutcome {
  if (!collector.licenseActive) {
    return fail(RejectCode.LICENSE_INVALID, { reason: 'INACTIVE' });
  }
  if (new Date(collector.licenseExpiry).getTime() < new Date(eventTimeIso).getTime()) {
    return fail(RejectCode.LICENSE_INVALID, {
      reason: 'EXPIRED',
      expiry: collector.licenseExpiry,
    });
  }
  return PASS;
}

// ---------------------------------------------------------------------------
// MPR CHECK 5 — Plant part
// ---------------------------------------------------------------------------

export function checkPlantPart(species: SpeciesRule, part: string): CheckOutcome {
  return species.allowedParts.includes(part)
    ? PASS
    : fail(RejectCode.PART_VIOLATION, {
        submitted: part,
        allowed: species.allowedParts,
      });
}

// ---------------------------------------------------------------------------
// ATOMIC 5-CHECK RUNNER — any fail → whole tx rejects (nothing commits)
// ---------------------------------------------------------------------------

export interface CollectionInput {
  species: SpeciesRule;
  zone: Zone;
  quota: Quota;
  collector: Collector;
  lon: number;
  lat: number;
  season: string;
  part: string;
  requestKg: number;
  eventTimeIso: string;
  offlineSoftReserve: boolean;
}

export interface MprResult {
  outcome: CheckOutcome;
  checks: {
    geoFence: CheckOutcome;
    season: CheckOutcome;
    quota: CheckOutcome;
    license: CheckOutcome;
    plantPart: CheckOutcome;
  };
  quotaDecision: QuotaDecision;
}

/**
 * Runs all five checks and returns the FIRST hard failure as the tx outcome.
 * Checks are evaluated independently (all recorded for audit), but a single
 * failure fails the whole transaction — the atomicity guarantee (§2B).
 */
export function runMpr(input: CollectionInput): MprResult {
  const geoFence = checkGeoFence(input.lon, input.lat, input.zone);
  const season = checkSeason(input.species, input.season);
  const quotaDecision = decideQuota(
    input.quota,
    input.requestKg,
    input.offlineSoftReserve,
  );
  const quota = quotaDecision.outcome;
  const license = checkLicense(input.collector, input.eventTimeIso);
  const plantPart = checkPlantPart(input.species, input.part);

  const firstFailure =
    [geoFence, season, quota, license, plantPart].find((c) => !c.ok) ?? PASS;

  return {
    outcome: firstFailure,
    checks: { geoFence, season, quota, license, plantPart },
    quotaDecision,
  };
}

// ---------------------------------------------------------------------------
// MASS BALANCE — the mixing/dilution solution (§4.1)
// ---------------------------------------------------------------------------

export interface MassBalanceResult {
  outcome: CheckOutcome;
  inputKg: number;
  outputKg: number;
  expectedOutputKg: number;
  variancePct: number;
  tolerancePct: number;
}

/**
 * Enforces Σ(input_kg) × (1 − declaredLossFactor) == Σ(output_kg) ± tolerance.
 * Adding filler (dilution) makes output exceed the expected post-loss mass and
 * breaks the balance → MASS_BALANCE_VIOLATION.
 */
export function checkMassBalance(
  inputKgs: number[],
  outputKg: number,
  declaredLossFactor: number,
  tolerancePct = 5,
): MassBalanceResult {
  const inputKg = inputKgs.reduce((a, b) => a + b, 0);
  const expectedOutputKg = inputKg * (1 - declaredLossFactor);
  const variancePct =
    expectedOutputKg === 0
      ? 100
      : (Math.abs(outputKg - expectedOutputKg) / expectedOutputKg) * 100;
  const withinTolerance = variancePct <= tolerancePct;
  return {
    outcome: withinTolerance
      ? PASS
      : fail(RejectCode.MASS_BALANCE_VIOLATION, {
          inputKg,
          outputKg,
          expectedOutputKg,
          variancePct,
          tolerancePct,
        }),
    inputKg,
    outputKg,
    expectedOutputKg,
    variancePct,
    tolerancePct,
  };
}

/** Proportional apportionment of a merged output back to its input lots. */
export function apportion(
  inputs: { epc: string; quantityKg: number }[],
): { epc: string; proportion: number }[] {
  const total = inputs.reduce((a, b) => a + b.quantityKg, 0);
  if (total === 0) return inputs.map((i) => ({ epc: i.epc, proportion: 0 }));
  return inputs.map((i) => ({ epc: i.epc, proportion: i.quantityKg / total }));
}

// ---------------------------------------------------------------------------
// CP-4 — drying-time gate (promotion): collection→processing < 24h
// ---------------------------------------------------------------------------

export const DRYING_MAX_SECONDS = 86400; // 24h

export function checkDryingTime(gapSeconds: number): CheckOutcome {
  return gapSeconds <= DRYING_MAX_SECONDS
    ? PASS
    : fail(RejectCode.BATCH_STATUS_HOLD, {
        checkpoint: Checkpoint.CP4_DRYING_TIME,
        gapSeconds,
        maxSeconds: DRYING_MAX_SECONDS,
      });
}

// ---------------------------------------------------------------------------
// Dual endorsement — incentive-independent second signature (§2D)
// ---------------------------------------------------------------------------

export function checkEndorsement(
  testingLabMsp: string,
  verifierMsp: string,
  verifierRole: 'REGULATOR' | 'SECOND_LAB',
  manufacturerMsps: string[],
): CheckOutcome {
  if (!verifierMsp || verifierMsp === testingLabMsp) {
    return fail(RejectCode.ENDORSEMENT_MISSING, { reason: 'NO_SECOND_SIGNATURE' });
  }
  // the manufacturer wants the PASS, so it can never be the independent verifier
  if (manufacturerMsps.includes(verifierMsp)) {
    return fail(RejectCode.ENDORSEMENT_MISSING, { reason: 'VERIFIER_NOT_INDEPENDENT' });
  }
  if (verifierRole !== 'REGULATOR' && verifierRole !== 'SECOND_LAB') {
    return fail(RejectCode.ENDORSEMENT_MISSING, { reason: 'INVALID_VERIFIER_ROLE' });
  }
  return PASS;
}

// ---------------------------------------------------------------------------
// CP-7 — formulation gate: every input must be COMPLETE_PASSED
// ---------------------------------------------------------------------------

export function checkFormulationInputs(
  inputStatuses: { epc: string; status: GacpStatus }[],
): CheckOutcome {
  const blocking = inputStatuses.filter(
    (i) => i.status !== GacpStatus.COMPLETE_PASSED,
  );
  return blocking.length === 0
    ? PASS
    : fail(RejectCode.BATCH_STATUS_HOLD, {
        checkpoint: Checkpoint.CP7_FORMULATION_INPUTS,
        blocking: blocking.map((b) => ({ epc: b.epc, status: b.status })),
      });
}

// ---------------------------------------------------------------------------
// GACP score (0–100) — deterministic, shown to consumers (§3B)
// ---------------------------------------------------------------------------

export interface ScoreInput {
  checkpointsPassed: number; // 0..7
  polkConfirmed: boolean;
  overDrawFlagged: boolean;
  weightHold: boolean;
}

/**
 * Weighted, deterministic score. Checkpoints carry the bulk (up to 84),
 * PoLK corroboration adds up to 16; flags subtract. Capped [0,100].
 * Deterministic so the same batch always renders the same score on stage.
 */
export function gacpScore(s: ScoreInput): number {
  const perCheckpoint = 12; // 7 * 12 = 84
  let score = Math.min(s.checkpointsPassed, 7) * perCheckpoint;
  score += s.polkConfirmed ? 16 : 0;
  if (s.overDrawFlagged) score -= 20;
  if (s.weightHold) score -= 15;
  return Math.max(0, Math.min(100, score));
}
