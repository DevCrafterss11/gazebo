import { mockDroneModels } from '../../mocks/flight';
import type { DroneModel } from '../../types/drone';
import type { DroneService } from '../contracts';

export class MockDroneService implements DroneService {
  async getDroneModels(): Promise<DroneModel[]> {
    return mockDroneModels;
  }
}
