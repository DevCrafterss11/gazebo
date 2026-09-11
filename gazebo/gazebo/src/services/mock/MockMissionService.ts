import type { Mission, MissionUpload } from '../../types/mission';
import type { MissionService } from '../contracts';

export class MockMissionService implements MissionService {
  private mission: Mission | null = null;

  async getCurrentMission(): Promise<Mission | null> {
    return this.mission ? { ...this.mission, waypoints: [...this.mission.waypoints] } : null;
  }

  async uploadMission(mission: MissionUpload): Promise<Mission> {
    this.mission = { id: `mock-mission-${Date.now()}`, ...mission, waypoints: [...mission.waypoints], state: 'UPLOADED' };
    return { ...this.mission, waypoints: [...this.mission.waypoints] };
  }

  async startMission(): Promise<void> {
    if (!this.mission) throw new Error('没有可执行的任务');
    this.mission = { ...this.mission, state: 'RUNNING' };
  }

  async clearMission(): Promise<void> {
    this.mission = null;
  }
}
