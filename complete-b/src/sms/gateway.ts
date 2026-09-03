/**
 * Tier-3 SMS gateway handler (component 1).
 *
 * HONESTY TAG: 🟢 BUILT — parse → authenticate sender → enrich → submit → map result to
 * an SMS reply, all unit-tested with injected dependencies. 🟡 SIMULATED — the live
 * Twilio inbound webhook + outbound SMS transport; wire it by implementing the injected
 * `CollectionSubmitter` with the `HttpCollectionSubmitter` (below) or a Twilio client.
 *
 * Contract discipline: builds the frozen `CollectionRequest` with `entryMethod:
 * 'TIER3_SMS'` and maps a `Rejected.code` to `REJECT_MESSAGES` copy. No fields added.
 *
 * Security (spec §1): the sender number must map to a registered collector; per-number
 * rate limiting; idempotency on the provider message SID (SMS retries must not double-
 * submit); lat/lon is never trusted here — it still passes the chaincode geo-fence.
 */
import {
  REJECT_MESSAGES,
  type ApiResult,
  type CollectionRequest,
  type CollectionResponse,
} from '../../contracts/index.js';
import { CONFIG } from '../config/config.js';
import { parseHerbSms, SMS_HELP } from './parser.js';
import { defaultPlantPart, resolveSeason } from './enrichment.js';

export interface InboundSms {
  /** Sender MSISDN. */
  from: string;
  body: string;
  /** Provider-unique message id (Twilio SID); the idempotency key. */
  messageSid: string;
  /** Delivery time; defaults to now if absent. */
  receivedAt?: Date;
}

export interface SmsReply {
  to: string;
  text: string;
  /** For observability/tests: how the message was classified. */
  outcome: 'COMMITTED' | 'REJECTED' | 'PARSE_ERROR' | 'UNREGISTERED' | 'RATE_LIMITED' | 'DUPLICATE' | 'ERROR';
}

/** Maps a sender number to a registered collector (or null if unknown). */
export interface CollectorDirectory {
  resolve(fromNumber: string): { collectorId: string } | null;
}

/** Idempotency store keyed by message SID. */
export interface IdempotencyStore {
  seen(sid: string): boolean;
  remember(sid: string, reply: SmsReply): void;
  get(sid: string): SmsReply | undefined;
}

/** Per-number rate limiter. */
export interface RateLimiter {
  allow(fromNumber: string, at: number): boolean;
}

/** Submits a collection to a contract-compatible gateway. */
export interface CollectionSubmitter {
  submit(req: CollectionRequest): Promise<ApiResult<CollectionResponse>>;
}

export interface SmsGatewayDeps {
  directory: CollectorDirectory;
  submitter: CollectionSubmitter;
  idempotency?: IdempotencyStore;
  rateLimiter?: RateLimiter;
  clock?: () => Date;
}

// ---- default in-memory implementations (dev/test) ---------------------------

export class InMemoryDirectory implements CollectorDirectory {
  constructor(private readonly map: Record<string, string>) {}
  resolve(fromNumber: string) {
    const collectorId = this.map[fromNumber];
    return collectorId ? { collectorId } : null;
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly store = new Map<string, SmsReply>();
  seen(sid: string) {
    return this.store.has(sid);
  }
  remember(sid: string, reply: SmsReply) {
    this.store.set(sid, reply);
  }
  get(sid: string) {
    return this.store.get(sid);
  }
}

/** Fixed-window per-number rate limiter. */
export class WindowRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly maxPerWindow = 5, private readonly windowMs = 60_000) {}
  allow(fromNumber: string, at: number) {
    const cutoff = at - this.windowMs;
    const recent = (this.hits.get(fromNumber) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.maxPerWindow) {
      this.hits.set(fromNumber, recent);
      return false;
    }
    recent.push(at);
    this.hits.set(fromNumber, recent);
    return true;
  }
}

/** 🟡 SIMULATED-until-run: submits over HTTP to CONFIG.apiBaseUrl (works vs the mock gateway). */
export class HttpCollectionSubmitter implements CollectionSubmitter {
  constructor(private readonly baseUrl: string = CONFIG.apiBaseUrl) {}
  async submit(req: CollectionRequest): Promise<ApiResult<CollectionResponse>> {
    const res = await fetch(`${this.baseUrl}/events/collection`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    return (await res.json()) as ApiResult<CollectionResponse>;
  }
}

// ---- the handler ------------------------------------------------------------

const reply = (to: string, text: string, outcome: SmsReply['outcome']): SmsReply => ({ to, text, outcome });

/**
 * Handle one inbound SMS end-to-end. Never throws for expected conditions; a transport
 * failure from the submitter is caught and returned as an ERROR reply.
 */
export async function handleInboundSms(sms: InboundSms, deps: SmsGatewayDeps): Promise<SmsReply> {
  const clock = deps.clock ?? (() => new Date());
  const now = (sms.receivedAt ?? clock()).getTime();

  // Idempotency: a retried SID returns the original reply, no re-submit.
  if (deps.idempotency?.seen(sms.messageSid)) {
    const prior = deps.idempotency.get(sms.messageSid);
    return prior ?? reply(sms.from, 'Your previous message is being processed.', 'DUPLICATE');
  }

  const finalize = (r: SmsReply): SmsReply => {
    deps.idempotency?.remember(sms.messageSid, r);
    return r;
  };

  // Rate limit per sender.
  if (deps.rateLimiter && !deps.rateLimiter.allow(sms.from, now)) {
    return finalize(reply(sms.from, 'Too many messages. Please wait a minute and resend.', 'RATE_LIMITED'));
  }

  // Sender must be a registered collector.
  const who = deps.directory.resolve(sms.from);
  if (!who) {
    return finalize(reply(sms.from, 'This number is not registered with NMPB. Contact your cluster CFA to enrol.', 'UNREGISTERED'));
  }

  // Parse.
  const parsed = parseHerbSms(sms.body);
  if (!parsed.ok) {
    return finalize(reply(sms.from, parsed.help ?? SMS_HELP, 'PARSE_ERROR'));
  }

  // The collector id in the message must match the one bound to the sender number.
  if (parsed.value.collectorId.toUpperCase() !== who.collectorId.toUpperCase()) {
    return finalize(
      reply(sms.from, `Collector ID does not match this number's registration (${who.collectorId}).`, 'UNREGISTERED'),
    );
  }

  // Enrich into the frozen CollectionRequest.
  const eventDate = sms.receivedAt ?? clock();
  const req: CollectionRequest = {
    speciesCode: parsed.value.speciesCode,
    quantityKg: parsed.value.quantityKg,
    plantPart: parsed.value.plantPart ?? defaultPlantPart(parsed.value.speciesCode),
    collectorId: who.collectorId,
    season: resolveSeason(eventDate),
    location: { lat: parsed.value.lat, lon: parsed.value.lon, altitudeM: 0 },
    entryMethod: 'TIER3_SMS',
  };

  // Submit.
  let result: ApiResult<CollectionResponse>;
  try {
    result = await deps.submitter.submit(req);
  } catch {
    return finalize(reply(sms.from, 'Network error reaching the ledger. Your message was not recorded — please resend.', 'ERROR'));
  }

  if (result.ok) {
    const { epc, txId, gacpScore } = result.data;
    return finalize(
      reply(sms.from, `Recorded ✓ Batch ${epc} | tx ${txId} | GACP ${gacpScore}.`, 'COMMITTED'),
    );
  }

  // Map the typed reject code to human SMS copy.
  const copy = REJECT_MESSAGES[result.code] ?? result.message ?? 'Your collection was rejected.';
  return finalize(reply(sms.from, `Rejected: ${copy}`, 'REJECTED'));
}
