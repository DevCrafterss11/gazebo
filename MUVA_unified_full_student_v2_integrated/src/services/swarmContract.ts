import type { SwarmConfig, SwarmDrone, SwarmMission, SwarmSnapshot } from '../types/swarm';

export interface SwarmService {
  initialize(config: SwarmConfig): SwarmSnapshot;
  loadMission(missions: SwarmMission[]): void;
  markReady(): void;
  getFleet(): SwarmDrone[];
  getStatus(): SwarmSnapshot;
  takeoff(): void;
  startMission(): void;
  pauseMission(): void;
  resumeMission(): void;
  returnToHome(): void;
  returnDroneToHome(droneId: string): void;
  stop(): void;
  subscribeTelemetry(listener: (snapshot: SwarmSnapshot) => void): () => void;
  dispose(): void;
}
