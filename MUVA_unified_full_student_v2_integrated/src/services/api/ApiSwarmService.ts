import type { SwarmConfig, SwarmDrone, SwarmMission, SwarmSnapshot } from '../../types/swarm';
import type { SwarmService } from '../swarmContract';

const unavailable = (): never => { throw new Error('真实多机仿真服务尚未接入，请切换 Mock 数据源'); };

export class ApiSwarmService implements SwarmService {
  initialize(_config: SwarmConfig): SwarmSnapshot { return unavailable(); }
  loadMission(_missions: SwarmMission[]): void { unavailable(); }
  markReady(): void { unavailable(); }
  getFleet(): SwarmDrone[] { return unavailable(); }
  getStatus(): SwarmSnapshot { return unavailable(); }
  takeoff(): void { unavailable(); }
  startMission(): void { unavailable(); }
  pauseMission(): void { unavailable(); }
  resumeMission(): void { unavailable(); }
  returnToHome(): void { unavailable(); }
  returnDroneToHome(_droneId: string): void { unavailable(); }
  stop(): void { unavailable(); }
  subscribeTelemetry(_listener: (snapshot: SwarmSnapshot) => void): () => void { return unavailable(); }
  dispose(): void { unavailable(); }
}
