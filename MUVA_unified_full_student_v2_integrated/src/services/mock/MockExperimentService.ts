import {
  createPreflightChecklist,
  createUncheckedSensors,
  healthySensorDetails,
} from '../../mocks/configuration';
import { getPreflightFailureReason } from '../../domain/experimentValidation';
import type {
  ExperimentConfiguration,
  PreflightChecklistItem,
  SensorCheckItem,
} from '../../types/configuration';
import type { ExperimentResult } from '../../types/result';
import type { ExperimentProgressEvent } from '../../types/experiment';
import { waitForCheck } from '../checkSequence';
import type { ExperimentRecord } from '../../types/record';
import type { CreateExperimentSessionInput, ExperimentSession } from '../../types/session';
import type { ExperimentService, PersistedExperimentState, PreflightCheckContext } from '../contracts';
import type { ExperimentOneAssessment } from '../../types/experiment1Assessment';
import { normalizeExperiment1Assessment } from '../../domain/experiment1Assessment';
import { validFlightMapView } from '../../domain/flightMap';

const storageKey = 'muva-experiment-1';
const recordsStorageKey = 'muva-experiment-records';
const assessmentStorageKey = 'muva-experiment1-assessments';
const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const cloneSensors = (items: SensorCheckItem[]): SensorCheckItem[] =>
  items.map((item) => ({ ...item, details: [...item.details] }));

const clonePreflight = (items: PreflightChecklistItem[]): PreflightChecklistItem[] =>
  items.map((item) => ({ ...item }));

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const migrateDraft = (value: unknown): PersistedExperimentState | null => {
  if (!isRecord(value) || !isRecord(value.configuration)) return null;
  const configuration = value.configuration as Partial<ExperimentConfiguration>;
  if (!configuration.flightController || !configuration.flightParameters) return null;
  const rawStep = typeof value.currentStep === 'number' ? value.currentStep : 1;
  if (value.version === 2) {
    const currentStep = Math.max(1, Math.min(8, rawStep));
    return {
      version: 2,
      flightMapView: validFlightMapView(value.flightMapView) ? value.flightMapView : null,
      progressId: typeof value.progressId === 'string' ? value.progressId : undefined,
      learningProgress: isRecord(value.learningProgress) ? value.learningProgress as PersistedExperimentState['learningProgress'] : undefined,
      currentStep,
      completedSteps: Array.isArray(value.completedSteps)
        ? [...new Set(value.completedSteps.filter((step): step is number => typeof step === 'number' && Number.isInteger(step) && step >= 1 && step <= 8))]
        : [],
      configuration: {
        ...configuration as ExperimentConfiguration,
        sensors: createUncheckedSensors(),
        homePosition: configuration.homePosition ?? null,
      },
      sessionId: typeof value.sessionId === 'string' ? value.sessionId : null,
      session: isRecord(value.session) ? value.session as unknown as ExperimentSession : null,
      result: isRecord(value.result) ? value.result as unknown as ExperimentResult : null,
      assessment: isRecord(value.assessment) ? value.assessment as unknown as ExperimentOneAssessment : null,
    };
  }

  const migratedStep = rawStep <= 1 ? 1 : rawStep <= 4 ? 2 : rawStep === 5 ? 3 : 4;
  return {
    version: 2,
    currentStep: migratedStep,
    completedSteps: Array.from({ length: migratedStep - 1 }, (_, index) => index + 1),
    configuration: {
      ...configuration as ExperimentConfiguration,
      sensors: createUncheckedSensors(),
      homePosition: null,
    },
  };
};

export class MockExperimentService implements ExperimentService {
  private readonly sessions = new Map<string, ExperimentSession>();

  async createExperiment(input: CreateExperimentSessionInput): Promise<ExperimentSession> {
    const createdAt = new Date().toISOString();
    const session: ExperimentSession = {
      id: `muva-exp-${crypto.randomUUID()}`,
      name: input.name,
      drone: input.drone,
      scene: input.scene,
      createdAt,
      startedAt: null,
      status: 'CREATED',
      configuration: input.configuration,
    };
    this.sessions.set(session.id, session);
    return { ...session };
  }

  async saveConfiguration(state: PersistedExperimentState): Promise<void> {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  async loadConfiguration(): Promise<PersistedExperimentState | null> {
    const serialized = localStorage.getItem(storageKey);
    if (!serialized) {
      return null;
    }
    try {
      const draft = migrateDraft(JSON.parse(serialized) as unknown);
      if (draft?.assessment && draft.sessionId) draft.assessment = normalizeExperiment1Assessment(draft.assessment, draft.sessionId);
      if (draft?.session && draft.session.id === draft.sessionId) this.sessions.set(draft.session.id, draft.session);
      return draft;
    } catch {
      localStorage.removeItem(storageKey);
      return null;
    }
  }

  async startExperiment(experimentId: string): Promise<void> {
    const session = this.sessions.get(experimentId);
    if (!session) throw new Error('实验 Session 不存在');
    session.status = 'STARTING';
    session.startedAt = new Date().toISOString();
    await delay(80);
    session.status = 'RUNNING';
  }

  async finishExperiment(_experimentId: string, result: ExperimentResult): Promise<ExperimentResult> {
    return result;
  }

  async saveRecord(record: ExperimentRecord): Promise<void> {
    const records = await this.listRecords();
    const nextRecords = [record, ...records.filter((item) => item.id !== record.id)];
    localStorage.setItem(recordsStorageKey, JSON.stringify(nextRecords));
  }

  async listRecords(): Promise<ExperimentRecord[]> {
    const serialized = localStorage.getItem(recordsStorageKey);
    if (!serialized) return [];
    try {
      const parsed: unknown = JSON.parse(serialized);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is ExperimentRecord => (
        typeof item === 'object'
        && item !== null
        && 'id' in item
        && typeof item.id === 'string'
        && 'session' in item
        && 'result' in item
        && 'telemetryHistory' in item
        && Array.isArray(item.telemetryHistory)
      ));
    } catch {
      return [];
    }
  }

  async getRecord(recordId: string): Promise<ExperimentRecord | null> {
    const records = await this.listRecords();
    return records.find((record) => record.id === recordId) ?? null;
  }

  async saveAssessment(assessment: ExperimentOneAssessment): Promise<void> {
    try {
      const serialized = localStorage.getItem(assessmentStorageKey);
      const parsed: unknown = serialized ? JSON.parse(serialized) : {};
      const assessments: Record<string, ExperimentOneAssessment> = isRecord(parsed) ? parsed as Record<string, ExperimentOneAssessment> : {};
      assessments[assessment.sessionId] = assessment;
      localStorage.setItem(assessmentStorageKey, JSON.stringify(assessments));
    } catch (error: unknown) {
      throw new Error(error instanceof Error ? `评分记录保存失败：${error.message}` : '评分记录保存失败');
    }
  }

  async loadAssessment(sessionId: string): Promise<ExperimentOneAssessment | null> {
    const serialized = localStorage.getItem(assessmentStorageKey);
    if (!serialized) return null;
    try {
      const assessments: unknown = JSON.parse(serialized);
      if (!isRecord(assessments)) return null;
      const assessment = assessments[sessionId];
      return isRecord(assessment) && assessment.sessionId === sessionId ? normalizeExperiment1Assessment(assessment as unknown as ExperimentOneAssessment, sessionId) : null;
    } catch {
      return null;
    }
  }

  async clearConfiguration(): Promise<void> {
    localStorage.removeItem(storageKey);
  }

  async runSensorCheck(onUpdate: (items: SensorCheckItem[]) => void, onProgress?: (event: ExperimentProgressEvent) => void, signal?: AbortSignal): Promise<SensorCheckItem[]> {
    const sensors = createUncheckedSensors();
    onUpdate(cloneSensors(sensors));

    await waitForCheck(280, signal);

    for (let index = 0; index < sensors.length; index += 1) {
      const current = sensors[index];
      if (!current) {
        continue;
      }
      current.status = 'CHECKING';
      onProgress?.({ type: 'sensor_check', step: current.name, status: 'checking' });
      current.details = ['检查中...'];
      onUpdate(cloneSensors(sensors));
      await waitForCheck(520, signal);
      current.status = 'PASS';
      onProgress?.({ type: 'sensor_check', step: current.name, status: 'pass' });
      current.details = [...healthySensorDetails[current.id]];
      onUpdate(cloneSensors(sensors));
    }

    return cloneSensors(sensors);
  }

  async runPreflightCheck(
    context: PreflightCheckContext,
    onUpdate: (items: PreflightChecklistItem[]) => void,
    onProgress?: (event: ExperimentProgressEvent) => void,
    signal?: AbortSignal,
  ): Promise<PreflightChecklistItem[]> {
    const items = createPreflightChecklist();
    onUpdate(clonePreflight(items));
    for (const item of items) {
      item.status = 'CHECKING';
      onProgress?.({ type: 'preflight_check', step: item.label, status: 'checking' });
      onUpdate(clonePreflight(items));
      await waitForCheck(360, signal);
      const reason = getPreflightFailureReason(item.id, context);
      item.status = reason ? 'FAIL' : 'PASS';
      onProgress?.({ type: 'preflight_check', step: item.label, status: reason ? 'fail' : 'pass' });
      item.reason = reason ?? undefined;
      onUpdate(clonePreflight(items));
    }
    return clonePreflight(items);
  }
}
