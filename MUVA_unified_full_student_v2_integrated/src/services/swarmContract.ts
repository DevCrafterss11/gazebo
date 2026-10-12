import type { SwarmConfig, SwarmDrone, SwarmMission, SwarmMissionReceipt, SwarmSnapshot } from '../types/swarm';

export interface SwarmService {
  readonly mode: 'mock' | 'sitl';
  readonly label: string;
  initialize(config: SwarmConfig): SwarmSnapshot | Promise<SwarmSnapshot>;
  restore(config: SwarmConfig, missions: SwarmMission[], snapshot: SwarmSnapshot): SwarmSnapshot | Promise<SwarmSnapshot>;
  loadMission(missions: SwarmMission[]): void;
  uploadMission(missions: SwarmMission[], planId: string): Promise<SwarmMissionReceipt[]>;
  markReady(): void | Promise<void>;
  getFleet(): SwarmDrone[];
  getStatus(): SwarmSnapshot;
  takeoff(): void | Promise<void>;
  startMission(): void | Promise<void>;
  pauseMission(): void | Promise<void>;
  resumeMission(): void | Promise<void>;
  returnToHome(): void | Promise<void>;
  returnDroneToHome(droneId: string): void | Promise<void>;
  stop(): void;
  shutdown(sessionId?: string): void | Promise<void>;
  subscribeTelemetry(listener: (snapshot: SwarmSnapshot) => void): () => void;
  dispose(): void;
}
