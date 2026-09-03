/**
 * IoT weighbridge + RFID custody subscriber (component 7).
 *
 * HONESTY TAG: 🟡 SIMULATED — subscribes to weight + RFID topics on an `MqttLike` broker
 * (the mock in dev/tests, a real MQTT client in prod) and builds the frozen
 * `AggregationRequest`. The variance logic it uses is 🟢 BUILT (variance.ts). Real scale +
 * RFID reader are 🔵 DESIGNED.
 *
 * Behaviours:
 *   - Tracks the last-known measured weight per (scale, container).
 *   - Sensor dropout: if a weigh is requested with no reading fresh enough, it falls back
 *     to the last-known value and FLAGS 'SENSOR_DROPOUT_LAST_KNOWN' (never silent).
 *   - RFID reads append a custody log (shipping = OUT, receiving = IN).
 *   - Variance > tolerance → the request is flagged WEIGHT_VARIANCE_HOLD before submission.
 */
import type { AggregationRequest } from '../../contracts/index.js';
import type { MqttLike } from './broker.js';
import { computeWeigh, DEFAULT_TOLERANCE_PCT, type WeighResult } from './variance.js';

export interface WeightMessage {
  scaleId: string;
  containerEpc: string;
  weightKg: number;
  ts: number;
}

export interface RfidRead {
  readerId: string;
  tagEpc: string;
  containerEpc: string;
  direction: 'IN' | 'OUT';
  ts: number;
}

export interface CustodyEntry {
  containerEpc: string;
  tagEpc: string;
  bizStep: 'receiving' | 'shipping';
  readerId: string;
  ts: number;
}

export interface WeighbridgeOptions {
  weightTopic?: string;
  rfidTopic?: string;
  tolerancePct?: number;
  /** Max age (ms) a reading may have and still count as fresh for a weigh. */
  freshnessMs?: number;
}

export interface BuildAggregationParams {
  parentEpc: string;
  childEpcs: string[];
  declaredKg: number;
  zoneId: string;
  scaleId: string;
  /** "now" for the freshness check. */
  atMs: number;
}

export interface AggregationBuildResult {
  request: AggregationRequest;
  weigh: WeighResult;
  flags: string[];
}

export class Weighbridge {
  private readonly weightTopic: string;
  private readonly rfidTopic: string;
  private readonly tolerancePct: number;
  private readonly freshnessMs: number;
  /** key `${scaleId}::${containerEpc}` → last reading. */
  private readonly lastWeight = new Map<string, WeightMessage>();
  readonly custody: CustodyEntry[] = [];

  constructor(broker: MqttLike, options: WeighbridgeOptions = {}) {
    this.weightTopic = options.weightTopic ?? 'ayurtrace/weighbridge/#';
    this.rfidTopic = options.rfidTopic ?? 'ayurtrace/rfid/#';
    this.tolerancePct = options.tolerancePct ?? DEFAULT_TOLERANCE_PCT;
    this.freshnessMs = options.freshnessMs ?? 60_000;

    broker.subscribe(this.weightTopic, (_t, payload) => this.onWeight(payload));
    broker.subscribe(this.rfidTopic, (_t, payload) => this.onRfid(payload));
  }

  private key(scaleId: string, containerEpc: string): string {
    return `${scaleId}::${containerEpc}`;
  }

  private onWeight(payload: string): void {
    let msg: WeightMessage;
    try {
      msg = JSON.parse(payload) as WeightMessage;
    } catch {
      return; // ignore malformed sensor frames
    }
    if (!msg.scaleId || !msg.containerEpc || typeof msg.weightKg !== 'number') return;
    this.lastWeight.set(this.key(msg.scaleId, msg.containerEpc), msg);
  }

  private onRfid(payload: string): void {
    let read: RfidRead;
    try {
      read = JSON.parse(payload) as RfidRead;
    } catch {
      return;
    }
    if (!read.containerEpc || !read.tagEpc) return;
    this.custody.push({
      containerEpc: read.containerEpc,
      tagEpc: read.tagEpc,
      bizStep: read.direction === 'IN' ? 'receiving' : 'shipping',
      readerId: read.readerId,
      ts: read.ts,
    });
  }

  /** Latest measured weight for a container on a scale, if any. */
  lastMeasured(scaleId: string, containerEpc: string): WeightMessage | undefined {
    return this.lastWeight.get(this.key(scaleId, containerEpc));
  }

  custodyFor(containerEpc: string): CustodyEntry[] {
    return this.custody.filter((c) => c.containerEpc === containerEpc);
  }

  /**
   * Build an AggregationRequest from the latest scale reading. Throws only if no reading
   * has ever been seen for the container (nothing to weigh); a stale reading is used with
   * a SENSOR_DROPOUT_LAST_KNOWN flag rather than failing.
   */
  buildAggregation(params: BuildAggregationParams): AggregationBuildResult {
    const reading = this.lastMeasured(params.scaleId, params.parentEpc);
    if (!reading) {
      throw new Error(`Weighbridge: no reading for container ${params.parentEpc} on scale ${params.scaleId}`);
    }

    const flags: string[] = [];
    if (params.atMs - reading.ts > this.freshnessMs) {
      flags.push('SENSOR_DROPOUT_LAST_KNOWN');
    }

    const weigh = computeWeigh(params.declaredKg, reading.weightKg, this.tolerancePct);
    if (weigh.result === 'WEIGHT_VARIANCE_HOLD') flags.push('WEIGHT_VARIANCE_HOLD');

    const request: AggregationRequest = {
      parentEpc: params.parentEpc,
      childEpcs: params.childEpcs,
      declaredKg: params.declaredKg,
      measuredKg: reading.weightKg,
      zoneId: params.zoneId,
    };

    return { request, weigh, flags };
  }
}
