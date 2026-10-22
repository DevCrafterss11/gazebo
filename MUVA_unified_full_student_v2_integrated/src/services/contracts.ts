import type { ExperimentConfiguration, PreflightChecklistItem, SensorCheckItem, TrainingScene } from '../types/configuration';
import type { DroneModel } from '../types/drone';
import type { EnvironmentLogEntry, EnvironmentRuntimeStatus, EnvironmentStartRequest, EnvironmentStartupState } from '../types/environment';
import type { ExperimentResult } from '../types/result';
import type { CreateExperimentSessionInput, ExperimentSession } from '../types/session';
import type { SimulatedDroneState } from '../types/simulator';
import type { FlightMapSnapshot, TelemetryConnectionState, TelemetrySample } from '../types/telemetry';
import type { FlightMapView } from '../types/flightMap';
import type { Mission, MissionUpload } from '../types/mission';
import type { ExperimentRecord } from '../types/record';
import type { CheckOutcome } from '../types/configuration';
import type { FlightSafetyContext } from '../domain/flightSafety';
import type { ExperimentProgressEvent } from '../types/experiment';
import type { ExperimentOneAssessment } from '../types/experiment1Assessment';
import type { SecurityConfig, SecurityEvidence, SecurityJudgment, SecurityReport, SecurityRun, SecurityTelemetry } from '../types/securityExperiment';
import type { CustomSecurityConfig, CustomSecurityReport, CustomSecurityRun, RuleEvidence } from '../types/customSecurity';

export interface DroneService {
  getDroneModels(): Promise<DroneModel[]>;
}

export interface SceneService {
  getScenes(): Promise<TrainingScene[]>;
}

export interface PersistedExperimentState {
  version: 2;
  flightMapView?: FlightMapView | null;
  progressId?: string;
  learningProgress?: {
    learnedPartIds: string[];
    quizAnswers: Record<string, Record<string, string>>;
  };
  currentStep: number;
  completedSteps: number[];
  configuration: ExperimentConfiguration;
  sessionId?: string | null;
  session?: ExperimentSession | null;
  result?: ExperimentResult | null;
  assessment?: ExperimentOneAssessment | null;
}

export interface PreflightCheckContext {
  configuration: ExperimentConfiguration;
  runtime: EnvironmentRuntimeStatus;
  environmentReady: boolean;
  systemCheckStatus: CheckOutcome;
  vehicleArmed: boolean;
}

export interface ExperimentService {
  createExperiment(input: CreateExperimentSessionInput): Promise<ExperimentSession>;
  saveConfiguration(state: PersistedExperimentState): Promise<void>;
  loadConfiguration(): Promise<PersistedExperimentState | null>;
  startExperiment(experimentId: string): Promise<void>;
  finishExperiment(experimentId: string, result: ExperimentResult): Promise<ExperimentResult>;
  saveRecord(record: ExperimentRecord): Promise<void>;
  listRecords(): Promise<ExperimentRecord[]>;
  getRecord(recordId: string): Promise<ExperimentRecord | null>;
  saveAssessment(assessment: ExperimentOneAssessment): Promise<void>;
  loadAssessment(sessionId: string): Promise<ExperimentOneAssessment | null>;
  clearConfiguration(): Promise<void>;
  runSensorCheck(onUpdate: (items: SensorCheckItem[]) => void, onProgress?: (event: ExperimentProgressEvent) => void, signal?: AbortSignal): Promise<SensorCheckItem[]>;
  runPreflightCheck(
    context: PreflightCheckContext,
    onUpdate: (items: PreflightChecklistItem[]) => void,
    onProgress?: (event: ExperimentProgressEvent) => void,
    signal?: AbortSignal,
  ): Promise<PreflightChecklistItem[]>;
}

export type EnvironmentStateHandler = (
  startup: EnvironmentStartupState,
  runtime: EnvironmentRuntimeStatus,
  logs: EnvironmentLogEntry[],
) => void;

export interface EnvironmentService {
  startEnvironment(request: EnvironmentStartRequest): Promise<EnvironmentRuntimeStatus>;
  stopEnvironment(): Promise<void>;
  getStatus(): Promise<EnvironmentRuntimeStatus>;
  getLogs(): Promise<EnvironmentLogEntry[]>;
  subscribe(handler: EnvironmentStateHandler): () => void;
}

export interface FlightService {
  initialize(home: { latitude: number; longitude: number }, maxAltitudeMeters?: number): Promise<void>;
  /** Returns the most recent state when the implementation has one. */
  getState(): SimulatedDroneState | null;
  arm(): Promise<void>;
  disarm(): Promise<void>;
  takeoff(altitudeMeters: number): Promise<void>;
  ascend(): Promise<void>;
  descend(): Promise<void>;
  moveForward(): Promise<void>;
  moveBackward(): Promise<void>;
  moveLeft(): Promise<void>;
  moveRight(): Promise<void>;
  yawLeft(): Promise<void>;
  yawRight(): Promise<void>;
  land(): Promise<void>;
  rtl(): Promise<void>;
  hold(): Promise<void>;
  move(direction: 'forward' | 'backward' | 'left' | 'right' | 'up' | 'down', meters: number): Promise<void>;
  yaw(direction: 'left' | 'right', degrees: number): Promise<void>;
  setMode(mode: 'GUIDED' | 'STABILIZE' | 'LOITER'): Promise<void>;
  beforeArmCheck(): Promise<void>;
  beforeTakeoffCheck(altitudeMeters: number): Promise<void>;
  beforeLandCheck(): Promise<void>;
  beforeRtlCheck(): Promise<void>;
}

export interface MissionService {
  getCurrentMission(): Promise<Mission | null>;
  uploadMission(mission: MissionUpload): Promise<Mission>;
  startMission(): Promise<void>;
  clearMission(): Promise<void>;
}

export type TelemetryHandler = (sample: TelemetrySample) => void;
export type TelemetryConnectionHandler = (state: TelemetryConnectionState) => void;

export interface TelemetryService {
  getFlightMap(): Promise<FlightMapSnapshot>;
  connect(): void;
  disconnect(): void;
  subscribe(handler: TelemetryHandler): () => void;
  subscribeToConnectionState(handler: TelemetryConnectionHandler): () => void;
}

export type SecurityTelemetryHandler = (sample: SecurityTelemetry) => void;
export interface SecurityExperimentService {
  createRun(config: SecurityConfig): Promise<SecurityRun>;
  getRun(runId: string): Promise<SecurityRun | null>;
  listReports(): Promise<SecurityReport[]>;
  startBaseline(runId: string): Promise<SecurityRun>;
  startAnomaly(runId: string): Promise<SecurityRun>;
  submitJudgment(runId: string, judgment: SecurityJudgment, evidenceIds: string[], requestId: string): Promise<SecurityRun>;
  isolate(runId: string): Promise<SecurityRun>;
  stopInjection(runId: string): Promise<SecurityRun>;
  verifyRecovery(runId: string): Promise<SecurityRun>;
  finish(runId: string, reflection: string): Promise<SecurityReport>;
  abort(runId: string): Promise<SecurityReport>;
  subscribe(runId: string, onSample: SecurityTelemetryHandler, onEvidence: (items: SecurityEvidence[]) => void): () => void;
}

export type CustomSecurityRunHandler = (run: CustomSecurityRun) => void;
export interface CustomSecurityService {
  createRun(config: CustomSecurityConfig, onUpdate: CustomSecurityRunHandler): Promise<CustomSecurityRun>;
  finish(runId: string, reflection: string, selectedEvidence: string[]): Promise<CustomSecurityReport>;
  abort(runId: string, reflection: string): Promise<CustomSecurityReport>;
  listReports(): Promise<CustomSecurityReport[]>;
  getRun(runId: string): Promise<CustomSecurityRun | null>;
  validateEvidence(runId: string, evidenceIds: string[]): Promise<RuleEvidence[]>;
}
