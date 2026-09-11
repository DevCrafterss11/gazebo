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
import type { ExperimentRecord } from '../../types/record';
import type { CreateExperimentSessionInput, ExperimentSession } from '../../types/session';
import type { ExperimentService, PersistedExperimentState, PreflightCheckContext } from '../contracts';

const storageKey = 'muva-experiment-1';
const recordsStorageKey = 'muva-experiment-records';
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
    const currentStep = Math.max(1, Math.min(4, rawStep));
    return {
      version: 2,
      currentStep,
      completedSteps: Array.isArray(value.completedSteps)
        ? value.completedSteps.filter((step): step is number => typeof step === 'number' && step < currentStep)
        : [],
      configuration: {
        ...configuration as ExperimentConfiguration,
        sensors: createUncheckedSensors(),
        homePosition: configuration.homePosition ?? null,
      },
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
      id: `muva-exp-${Date.now()}`,
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
      return migrateDraft(JSON.parse(serialized) as unknown);
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

  async clearConfiguration(): Promise<void> {
    localStorage.removeItem(storageKey);
  }

  async runSensorCheck(onUpdate: (items: SensorCheckItem[]) => void, onProgress?: (event: ExperimentProgressEvent) => void): Promise<SensorCheckItem[]> {
    const sensors = createUncheckedSensors();
    onUpdate(cloneSensors(sensors));

    await delay(280);

    for (let index = 0; index < sensors.length; index += 1) {
      const current = sensors[index];
      if (!current) {
        continue;
      }
      current.status = 'CHECKING';
      onProgress?.({ type: 'sensor_check', step: current.name, status: 'checking' });
      current.details = ['检查中...'];
      onUpdate(cloneSensors(sensors));
      await delay(520);
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
  ): Promise<PreflightChecklistItem[]> {
    const items = createPreflightChecklist();
    onUpdate(clonePreflight(items));
    for (const item of items) {
      item.status = 'CHECKING';
      onProgress?.({ type: 'preflight_check', step: item.label, status: 'checking' });
      onUpdate(clonePreflight(items));
      await delay(360);
      const reason = getPreflightFailureReason(item.id, context);
      item.status = reason ? 'FAIL' : 'PASS';
      onProgress?.({ type: 'preflight_check', step: item.label, status: reason ? 'fail' : 'pass' });
      item.reason = reason ?? undefined;
      onUpdate(clonePreflight(items));
    }
    return clonePreflight(items);
  }
}
