import { mockScenes } from '../../mocks/configuration';
import type { TrainingScene } from '../../types/configuration';
import type { SceneService } from '../contracts';

export class MockSceneService implements SceneService {
  async getScenes(): Promise<TrainingScene[]> {
    return mockScenes;
  }
}
