import type {
  CustomEngineResult,
  CustomSecurityConfig,
  CustomSecurityEvent,
  CustomSecurityMetrics,
  DetectionRule,
  InjectionTruth,
  ObservationLog,
  ObservableTelemetry,
  RuleEvidence,
} from '../../types/customSecurity';
import { digest, ENGINE_VERSION } from './config';

const TICK_MS = 250;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 2246822519) + 3266489917) >>> 0;
    return state / 4294967296;
  };
}

function activeEvent(events: CustomSecurityEvent[], type: CustomSecurityEvent['type'], elapsedMs: number): CustomSecurityEvent | null {
  return events.find((event) => event.enabled && event.type === type && elapsedMs >= event.startSec * 1000 && elapsedMs < (event.startSec + event.durationSec) * 1000) ?? null;
}

function frame(
  runId: string,
  index: number,
  capturedAtMs: number,
  sequence: number,
  receivedAtMs: number,
): ObservableTelemetry {
  return {
    frameId: `${runId}-frame-${index}`,
    sourceId: 'sim-source-01',
    epoch: 'epoch-01',
    sequence,
    capturedAtMs,
    receivedAtMs,
    clockBasis: 'session-calibrated',
    altitude: 12 + Math.sin(index / 15),
    speed: 3 + Math.abs(Math.cos(index / 11)),
    battery: Math.max(0, 100 - index * 0.025),
  };
}

function eventIdsAt(events: CustomSecurityEvent[], elapsedMs: number): string[] {
  return events.filter((event) => event.enabled && elapsedMs >= event.startSec * 1000 && elapsedMs < (event.startSec + event.durationSec) * 1000).map((event) => event.id);
}

function ruleTrigger(rule: DetectionRule, condition: boolean, count: number): boolean {
  return rule.enabled && condition && count >= rule.consecutive;
}

function validRate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function frameMetrics(observations: ObservationLog[]): CustomSecurityMetrics['frames'] {
  const anomaly = observations.filter((item) => item.truthAnomalous);
  const normal = observations.filter((item) => !item.truthAnomalous);
  const tp = anomaly.filter((item) => item.detected).length;
  const fp = normal.filter((item) => item.detected).length;
  return { tp, fp, fn: anomaly.length - tp, detection: { numerator: tp, denominator: anomaly.length, rate: validRate(tp, anomaly.length) }, falsePositive: { numerator: fp, denominator: normal.length, rate: validRate(fp, normal.length) } };
}

export function runCustomSecurityEngine(config: CustomSecurityConfig, runId: string): CustomEngineResult {
  const nextRandom = random(config.scenario.seed);
  const events = config.scenario.events.filter((event) => event.enabled);
  const observations: ObservationLog[] = [];
  const truthObservations: InjectionTruth['observations'] = {};
  const delivered: ObservableTelemetry[] = [];
  let sequence = 0;
  const history: ObservableTelemetry[] = [];
  let droppedFrames = 0;
  let interruptedFrames = 0;
  let queueDiscards: InjectionTruth['queueDiscards'] = [];
  const totalTicks = Math.ceil(config.scenario.durationSec * 1000 / TICK_MS);

  for (let tick = 0; tick < totalTicks; tick += 1) {
    const elapsedMs = tick * TICK_MS;
    const base = frame(runId, tick, elapsedMs, sequence, elapsedMs);
    sequence += 1;
    history.push(base);
    const replay = activeEvent(events, 'replay', elapsedMs);
    const loss = activeEvent(events, 'loss', elapsedMs);
    const delay = activeEvent(events, 'delay', elapsedMs);
    const interruption = activeEvent(events, 'interruption', elapsedMs);
    let selected = base;
    if (replay) {
      const lookback = Math.max(1, Math.round(replay.lookbackSec * 1000 / TICK_MS));
      const source = history[Math.max(0, history.length - lookback - 1)] ?? base;
      selected = { ...source, frameId: `${runId}-replay-${tick}`, receivedAtMs: elapsedMs };
    }
    const eventIds = eventIdsAt(events, elapsedMs);
    if (loss && nextRandom() < loss.lossRate) {
      droppedFrames += 1;
      continue;
    }
    if (delay) {
      const jitter = Math.round((nextRandom() * 2 - 1) * delay.jitterMs);
      selected = { ...selected, receivedAtMs: elapsedMs + Math.max(0, delay.delayMs + jitter) };
    }
    if (interruption) {
      interruptedFrames += 1;
      continue;
    }
    delivered.push(selected);
    truthObservations[selected.frameId] = { anomalous: Boolean(replay || delay), eventIds };
  }

  for (const event of events) {
    if (event.type === 'delay' || event.type === 'interruption') {
      const affected = delivered.filter((item) => item.receivedAtMs >= event.startSec * 1000 && item.receivedAtMs < (event.startSec + event.durationSec) * 1000).length;
      queueDiscards.push({ atMs: (event.startSec + event.durationSec) * 1000, count: affected, reason: '事件结束时丢弃剩余受扰动队列' });
    }
  }
  delivered.sort((left, right) => left.receivedAtMs - right.receivedAtMs || left.frameId.localeCompare(right.frameId));

  const lastBySource = new Map<string, ObservableTelemetry>();
  const streaks: Record<'age' | 'sequence' | 'gap', number> = { age: 0, sequence: 0, gap: 0 };
  const previousBySource = new Map<string, ObservableTelemetry>();
  const evidence: RuleEvidence[] = [];
  const strategyAcceptedIds: string[] = [];
  const controlIds = delivered.map((item) => item.frameId);
  let observationIndex = 0;
  for (const item of delivered) {
    const previous = lastBySource.get(item.sourceId);
    const age = item.receivedAtMs - item.capturedAtMs;
    const duplicateOrRegression = previous !== undefined && item.epoch === previous.epoch && item.sequence <= previous.sequence;
    const gap = previous !== undefined && item.receivedAtMs - previous.receivedAtMs > config.strategy.gap.threshold;
    streaks.age = age > config.strategy.age.threshold ? streaks.age + 1 : 0;
    streaks.sequence = duplicateOrRegression ? streaks.sequence + 1 : 0;
    streaks.gap = gap ? streaks.gap + 1 : 0;
    const triggered: Array<{ rule: 'age' | 'sequence' | 'gap'; detail: string; observationId: string }> = [];
    if (ruleTrigger(config.strategy.age, age > config.strategy.age.threshold, streaks.age)) triggered.push({ rule: 'age', detail: `数据年龄 ${age} ms 超过 ${config.strategy.age.threshold} ms`, observationId: item.frameId });
    if (ruleTrigger(config.strategy.sequence, duplicateOrRegression, streaks.sequence)) triggered.push({ rule: 'sequence', detail: `序号 ${item.sequence} 未超过前值 ${previous?.sequence ?? '—'}`, observationId: item.frameId });
    if (ruleTrigger(config.strategy.gap, gap, streaks.gap)) triggered.push({ rule: 'gap', detail: `接收间隔 ${item.receivedAtMs - (previous?.receivedAtMs ?? item.receivedAtMs)} ms 超过 ${config.strategy.gap.threshold} ms`, observationId: item.frameId });
    triggered.forEach((itemTrigger) => {
      const action = config.strategy[itemTrigger.rule].action;
      evidence.push({ id: `${runId}-evidence-${evidence.length + 1}`, atMs: item.receivedAtMs, rule: itemTrigger.rule, action, observationId: itemTrigger.observationId, detail: itemTrigger.detail });
    });
    const detected = triggered.length > 0;
    const filter = triggered.some((itemTrigger) => config.strategy[itemTrigger.rule].action === 'filter');
    const accepted = !filter;
    if (accepted) strategyAcceptedIds.push(item.frameId);
    const fresh = age <= config.strategy.recovery.maxAgeMs && (previous === undefined || item.receivedAtMs - previous.receivedAtMs <= config.strategy.recovery.maxGapMs) && !duplicateOrRegression;
    const truth = truthObservations[item.frameId] ?? { anomalous: false, eventIds: [] };
    observations.push({ id: `${runId}-observation-${observationIndex}`, frame: item, truthAnomalous: truth.anomalous, truthEventIds: truth.eventIds, detected, accepted, marked: triggered.some((itemTrigger) => config.strategy[itemTrigger.rule].action === 'mark'), fresh, reception: accepted ? 'receiving' : 'filtering' });
    observationIndex += 1;
    previousBySource.set(item.sourceId, item);
    lastBySource.set(item.sourceId, item);
  }

  const frames = frameMetrics(observations);
  const normal = observations.filter((item) => !item.truthAnomalous);
  const anomalous = observations.filter((item) => item.truthAnomalous);
  const recovery = events.map((event) => {
    const endMs = (event.startSec + event.durationSec) * 1000;
    const after = observations.filter((item) => item.frame.receivedAtMs >= endMs);
    let consecutive = 0;
    let recoveredAtMs: number | null = null;
    for (const item of after) {
      if (item.fresh && item.accepted) consecutive += 1;
      else consecutive = 0;
      if (consecutive >= config.strategy.recovery.consecutive) { recoveredAtMs = item.frame.receivedAtMs; break; }
    }
    return { eventIds: [event.id], endMs, recoveredAtMs, elapsedMs: recoveredAtMs === null ? null : Math.max(0, recoveredAtMs - endMs) };
  });
  const windowEvents = events.filter((event) => event.type === 'loss' || event.type === 'interruption');
  const windowDetected = windowEvents.map((event) => {
    const startMs = event.startSec * 1000;
    const endMs = (event.startSec + event.durationSec) * 1000;
    const detected = evidence.some((item) => item.atMs >= startMs && item.atMs <= endMs + config.strategy.gap.threshold);
    return { event, detected };
  });
  const windowsDetectedCount = windowDetected.filter((item) => item.detected).length;
  const normalChecks = windowEvents.length;
  const metrics: CustomSecurityMetrics = {
    frames,
    windows: { tp: windowsDetectedCount, fn: normalChecks - windowsDetectedCount, falseAlarms: 0, normalChecks, falsePositive: { numerator: 0, denominator: normalChecks, rate: validRate(0, normalChecks) }, detection: { numerator: windowsDetectedCount, denominator: normalChecks, rate: validRate(windowsDetectedCount, normalChecks) }, eventIds: windowEvents.map((event) => event.id) },
    normalRetention: { numerator: normal.filter((item) => item.accepted).length, denominator: normal.length, rate: validRate(normal.filter((item) => item.accepted).length, normal.length) },
    anomalyAcceptance: { numerator: anomalous.filter((item) => item.accepted).length, denominator: anomalous.length, rate: validRate(anomalous.filter((item) => item.accepted).length, anomalous.length) },
    controlAnomalyAcceptance: { numerator: anomalous.length, denominator: anomalous.length, rate: validRate(anomalous.length, anomalous.length) },
    recovery,
  };
  const truth: InjectionTruth = { observations: truthObservations, events, queueDiscards, droppedFrames, interruptedFrames };
  const inputIds = { control: controlIds, strategy: controlIds.slice() };
  const streamDigest = delivered.map((item) => ({ sourceId: item.sourceId, epoch: item.epoch, sequence: item.sequence, capturedAtMs: item.capturedAtMs, receivedAtMs: item.receivedAtMs }));
  return { engineVersion: ENGINE_VERSION, datasetId: config.scenario.source, datasetDigest: digest({ source: config.scenario.source, seed: config.scenario.seed }), inputDigest: digest({ stream: streamDigest, events }), durationMs: config.scenario.durationSec * 1000, observations, acceptedIds: strategyAcceptedIds, controlIds, inputIds, evidence, recovery, recoveryTransitions: recovery.flatMap((item) => item.recoveredAtMs === null ? [] : [item.recoveredAtMs]), truth };
}
