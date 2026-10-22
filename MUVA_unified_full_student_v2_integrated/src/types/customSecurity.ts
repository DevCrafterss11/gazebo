export type CustomEventType = 'replay' | 'delay' | 'loss' | 'interruption';
export type TelemetryAction = 'alert' | 'mark' | 'filter';
export type CustomRunStatus = 'draft' | 'validating' | 'ready' | 'running' | 'aborted' | 'failed' | 'completed';
export type CustomExperimentMode = 'training' | 'assessment';

export interface CustomSecurityEvent {
  id: string;
  type: CustomEventType;
  enabled: boolean;
  startSec: number;
  durationSec: number;
  lookbackSec: number;
  delayMs: number;
  jitterMs: number;
  lossRate: number;
  seed: number;
}

export interface DetectionRule {
  enabled: boolean;
  threshold: number;
  consecutive: number;
  action: TelemetryAction;
}

export interface CustomSecurityConfig {
  schemaVersion: 'custom-security.v1';
  hypothesis: string;
  mode: CustomExperimentMode;
  scenario: {
    id: string;
    version: number;
    source: 'seeded-telemetry-v1';
    durationSec: number;
    baselineSec: number;
    recoverySec: number;
    seed: number;
    frequencyHz: 4;
    queueCapacity: number;
    conflictOrder: 'replay-loss-delay-interruption.v1';
    queuePolicy: 'discard-on-interruption-and-event-end';
    events: CustomSecurityEvent[];
  };
  strategy: {
    id: string;
    version: number;
    age: DetectionRule;
    sequence: DetectionRule;
    gap: DetectionRule;
    recovery: { maxAgeMs: number; maxGapMs: number; consecutive: number };
  };
}

export interface ValidationIssue { field: string; message: string }

export interface ObservableTelemetry {
  frameId: string;
  sourceId: string;
  epoch: string;
  sequence: number;
  capturedAtMs: number;
  receivedAtMs: number;
  clockBasis: 'session-calibrated';
  altitude: number;
  speed: number;
  battery: number;
}

export type DetectorRuleName = 'age' | 'sequence' | 'gap';
export interface RuleEvidence {
  id: string;
  atMs: number;
  rule: DetectorRuleName;
  action: TelemetryAction;
  observationId: string | null;
  detail: string;
}

export interface ObservationLog {
  id: string;
  frame: ObservableTelemetry;
  detected: boolean;
  accepted: boolean;
  marked: boolean;
  fresh: boolean;
  reception: 'receiving' | 'filtering';
  truthAnomalous: boolean;
  truthEventIds: string[];
}

export interface InjectionTruth {
  observations: Record<string, { anomalous: boolean; eventIds: string[] }>;
  events: CustomSecurityEvent[];
  queueDiscards: Array<{ atMs: number; count: number; reason: string }>;
  droppedFrames: number;
  interruptedFrames: number;
}

export interface CustomEngineResult {
  engineVersion: string;
  datasetId: string;
  datasetDigest: string;
  inputDigest: string;
  durationMs: number;
  observations: ObservationLog[];
  acceptedIds: string[];
  controlIds: string[];
  inputIds: { control: string[]; strategy: string[] };
  evidence: RuleEvidence[];
  recovery: Array<{ eventIds: string[]; endMs: number; recoveredAtMs: number | null; elapsedMs: number | null }>;
  recoveryTransitions: number[];
  truth: InjectionTruth;
}

export interface RatioMetric { numerator: number; denominator: number; rate: number | null }
export interface CustomSecurityMetrics {
  frames: { tp: number; fp: number; fn: number; detection: RatioMetric; falsePositive: RatioMetric };
  windows: { tp: number; fn: number; falseAlarms: number; normalChecks: number; falsePositive: RatioMetric; detection: RatioMetric; eventIds: string[] };
  normalRetention: RatioMetric;
  anomalyAcceptance: RatioMetric;
  controlAnomalyAcceptance: RatioMetric;
  recovery: Array<{ eventIds: string[]; endMs: number; recoveredAtMs: number | null; elapsedMs: number | null }>;
}

export interface CustomSecurityReport {
  schemaVersion: 'custom-security-report.v1';
  runId: string;
  engineVersion: string;
  scoreVersion: string;
  datasetId: string;
  datasetDigest: string;
  inputDigest: string;
  config: CustomSecurityConfig;
  startedAt: string;
  endedAt: string;
  endReason: 'completed' | 'student-stop' | 'page-leave' | 'failure';
  status: 'completed' | 'aborted' | 'failed';
  metrics: CustomSecurityMetrics;
  score: { total: number; sections: Record<string, number>; passed: boolean; deductions: string[] } | null;
  label: string;
  selectedEvidence: string[];
  validEvidence: string[];
  reflection: string;
  result: CustomEngineResult;
}

export interface CustomSecurityRun {
  runId: string;
  status: 'running' | 'completed' | 'aborted' | 'failed';
  mode: CustomExperimentMode;
  elapsedMs: number;
  durationMs: number;
  playbackRate: number;
  datasetId: string;
  inputDigest: string;
  observations: ObservationLog[];
  evidence: RuleEvidence[];
  acceptedCount: number;
  truth: InjectionTruth | null;
  error: string | null;
}
