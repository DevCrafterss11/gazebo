export type SecurityCase = 'replay' | 'degradation' | 'hidden';
export type SecurityMode = 'training' | 'assessment';
export type SecurityPhase = 'preparation' | 'baseline' | 'anomaly' | 'recovery' | 'completed' | 'aborted' | 'failed';
export type SecurityJudgment = 'normal' | 'link_anomaly' | 'replay' | 'insufficient_evidence';

export interface SecurityConfig {
  caseId: SecurityCase;
  mode: SecurityMode;
  difficulty: 'low' | 'medium' | 'high';
}

export interface SecurityTelemetry {
  protocolVersion: 'security.telemetry.v1';
  runId: string;
  source: 'mavlink' | 'simulation';
  sequence: number;
  capturedAt: number;
  receivedAt: number;
  elapsedMs: number;
  receiveIntervalMs?: number | null;
  missingRatePct?: number | null;
  altitude: number;
  speed: number;
  battery: number;
  stale: boolean;
  connection: 'connected' | 'interrupted' | 'unavailable';
}

export interface SecurityEvidence {
  id: string;
  code: 'duplicate_sequence' | 'sequence_regression' | 'stale_data' | 'receive_gap' | 'packet_loss' | 'connection_interrupted' | 'recovered';
  detail: string;
  receivedAt: number;
  automatic: boolean;
}

export interface SecurityRun {
  runId: string;
  config: SecurityConfig;
  caseVersion: '1.0';
  seed: number | null;
  phase: SecurityPhase;
  source: 'mavlink' | 'simulation' | 'unavailable';
  telemetry: SecurityTelemetry | null;
  evidence: SecurityEvidence[];
  timeline: Array<{ at: number; label: string; kind: string }>;
  judgment: SecurityJudgment | null;
  judgments: Array<{ judgment: SecurityJudgment; evidenceIds: string[]; elapsedMs: number; falsePositive: boolean }>;
  evidenceIds: string[];
  isolation: 'not_submitted' | 'submitted' | 'accepted' | 'executed' | 'verified';
  score: { total: number; sections: Record<string, number>; deductions: string[] } | null;
  error?: string;
}

export interface SecurityReport {
  runId: string;
  config: SecurityConfig;
  caseVersion: '1.0';
  scoreVersion: 'security-score-v1';
  seed: number | null;
  phase: SecurityPhase;
  timeline: SecurityRun['timeline'];
  evidence: SecurityEvidence[];
  judgment: SecurityJudgment | null;
  judgments: SecurityRun['judgments'];
  isolation: SecurityRun['isolation'];
  reflection: string;
  recoveryMs: number | null;
  score: SecurityRun['score'];
  scoreSource: 'mock' | 'gateway';
  limitations: string[];
}
