/**
 * In-process MQTT-like pub/sub broker (component 7).
 *
 * HONESTY TAG: 🟡 SIMULATED — a dependency-free stand-in for a real MQTT broker + scale so
 * the weighbridge subscriber can be developed and TESTED against a mock publisher (spec §7:
 * "subscriber tested against a mock publisher"). A real deployment swaps this for an MQTT
 * client (e.g. mqtt.js) implementing the same `MqttLike` interface; the subscriber logic
 * does not change. Real scale + broker = 🔵 DESIGNED until run on the user's hardware.
 */
export type MqttHandler = (topic: string, payload: string) => void;

export interface MqttLike {
  subscribe(topicFilter: string, handler: MqttHandler): void;
  publish(topic: string, payload: string): void;
}

/** Supports exact topics and a single trailing '#' wildcard (MQTT-style). */
export class MockBroker implements MqttLike {
  private readonly subs: { filter: string; handler: MqttHandler }[] = [];

  subscribe(topicFilter: string, handler: MqttHandler): void {
    this.subs.push({ filter: topicFilter, handler });
  }

  publish(topic: string, payload: string): void {
    for (const sub of this.subs) {
      if (topicMatches(sub.filter, topic)) sub.handler(topic, payload);
    }
  }
}

export function topicMatches(filter: string, topic: string): boolean {
  if (filter === topic) return true;
  if (filter.endsWith('/#')) {
    const prefix = filter.slice(0, -1); // keep trailing slash
    return topic.startsWith(prefix);
  }
  if (filter === '#') return true;
  return false;
}
