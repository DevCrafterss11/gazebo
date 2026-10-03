import { mockExperiment, mockTrainingScore } from '../mocks/experiment';
import type { ExperimentDefinition, TrainingScore } from '../types/experiment';

export interface ExperimentApi {
  getExperiment(experimentId: string): Promise<ExperimentDefinition>;
  getTrainingScore(experimentId: string): Promise<TrainingScore>;
  startExperiment(experimentId: string): Promise<ExperimentDefinition>;
  finishExperiment(experimentId: string): Promise<TrainingScore>;
}

export const experimentApi: ExperimentApi = {
  async getExperiment() {
    return mockExperiment;
  },
  async getTrainingScore() {
    return mockTrainingScore;
  },
  async startExperiment() {
    return mockExperiment;
  },
  async finishExperiment() {
    return mockTrainingScore;
  },
};
