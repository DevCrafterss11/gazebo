import type { ExperimentConfiguration, TrainingScene } from './configuration';
import type { DroneModel } from './drone';

export type ExperimentSessionStatus = 'CREATED' | 'STARTING' | 'RUNNING' | 'FINISHED' | 'FAILED';

export interface ExperimentSession {
  id: string;
  name: string;
  drone: DroneModel;
  scene: TrainingScene;
  createdAt: string;
  startedAt: string | null;
  status: ExperimentSessionStatus;
  configuration: ExperimentConfiguration;
}

export interface CreateExperimentSessionInput {
  name: string;
  drone: DroneModel;
  scene: TrainingScene;
  configuration: ExperimentConfiguration;
}
