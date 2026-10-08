import { distance, homes, toLocal } from '../../domain/swarmGeometry';
import type { SwarmService } from '../swarmContract';
import type { Point, SwarmConfig, SwarmDrone, SwarmMission, SwarmSnapshot } from '../../types/swarm';

const clone = (snapshot: SwarmSnapshot): SwarmSnapshot => structuredClone(snapshot);
const terminal = (state: SwarmDrone['state']) => state === 'LANDED';

export class MockSwarmRuntime implements SwarmService {
  private snapshot: SwarmSnapshot = { status: 'DRAFT', drones: [], elapsed: 0, events: [], coverage: 0 };
  private missions: SwarmMission[] = [];
  private config: SwarmConfig | null = null;
  private listener: ((snapshot: SwarmSnapshot) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTime = 0;
  private returnRoutes = new Map<string, Point[]>();

  initialize(config: SwarmConfig): SwarmSnapshot {
    this.dispose();
    this.config = config;
    this.missions = [];
    const drones: SwarmDrone[] = homes(config.count).map((homePosition, index) => ({
      droneId: `UAV-${String(index + 1).padStart(2, '0')}`, displayName: `UAV-${String(index + 1).padStart(2, '0')}`, modelType: 'Iris', sysId: index + 1,
      homePosition, position: homePosition, targetAltitude: config.altitude, cruiseSpeed: config.speed, altitude: 0, speed: 0, heading: 0, battery: 100,
      state: 'READY', waypointIndex: 0, progress: 0, trajectory: [homePosition], completedSegments: 0,
    }));
    this.snapshot = { status: 'DRAFT', drones, elapsed: 0, events: ['Mock 仿真环境已就绪'], coverage: 0 };
    this.publish();
    return this.getStatus();
  }
  loadMission(missions: SwarmMission[]): void { this.missions = missions; this.snapshot.status = 'PLANNED'; this.publish(); }
  markReady(): void { this.ensure(['PLANNED', 'READY']); this.snapshot.status = 'READY'; this.publish(); }
  getFleet(): SwarmDrone[] { return this.getStatus().drones; }
  getStatus(): SwarmSnapshot { return clone(this.snapshot); }
  subscribeTelemetry(listener: (snapshot: SwarmSnapshot) => void): () => void { this.listener = listener; listener(this.getStatus()); return () => { if (this.listener === listener) this.listener = null; }; }
  private publish(): void { this.listener?.(this.getStatus()); }
  private log(message: string): void { this.snapshot.events = [...this.snapshot.events.slice(-79), `${Math.round(this.snapshot.elapsed)}s · ${message}`]; }
  private ensure(states: SwarmSnapshot['status'][]): void { if (!states.includes(this.snapshot.status)) throw new Error(`当前状态 ${this.snapshot.status} 不允许执行此操作`); }
  private startClock(): void { if (this.timer) return; this.lastTime = performance.now(); this.timer = setInterval(() => { const now = performance.now(); this.tick(Math.min(0.5, (now - this.lastTime) / 1000)); this.lastTime = now; }, 250); }
  private halt(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  takeoff(): void { this.ensure(['READY']); this.snapshot.status = 'TAKING_OFF'; this.snapshot.drones.forEach((drone) => { drone.state = 'TAKING_OFF'; }); this.log('机群分时起飞'); this.startClock(); this.publish(); }
  startMission(): void { this.ensure(['HOLDING']); this.snapshot.status = 'RUNNING'; this.snapshot.drones.filter((drone) => drone.state === 'HOLDING').forEach((drone) => { drone.state = 'RUNNING'; }); this.log('开始覆盖任务'); this.publish(); }
  pauseMission(): void { this.ensure(['RUNNING']); this.snapshot.status = 'PAUSED'; this.snapshot.drones.filter((drone) => drone.state === 'RUNNING').forEach((drone) => { drone.state = 'PAUSED'; drone.speed = 0; }); this.log('任务暂停，原地悬停'); this.publish(); }
  resumeMission(): void { this.ensure(['PAUSED']); this.snapshot.status = 'RUNNING'; this.snapshot.drones.filter((drone) => drone.state === 'PAUSED').forEach((drone) => { drone.state = 'RUNNING'; }); this.log('继续覆盖任务'); this.publish(); }
  returnDroneToHome(droneId: string): void {
    this.ensure(['TAKING_OFF', 'HOLDING', 'RUNNING', 'PAUSED', 'RETURNING']);
    const drone = this.snapshot.drones.find((item) => item.droneId === droneId);
    if (!drone || terminal(drone.state) || drone.state === 'RETURNING') throw new Error('该无人机当前无法返航');
    this.returnRoutes.set(droneId, [drone.homePosition]); drone.state = 'RETURNING'; this.log(`${droneId} 单机返航，剩余覆盖任务不再分配`); this.publish();
  }
  returnToHome(): void {
    this.ensure(['TAKING_OFF', 'HOLDING', 'RUNNING', 'PAUSED', 'RETURNING']);
    this.snapshot.status = 'RETURNING';
    this.snapshot.drones.filter((drone) => !terminal(drone.state)).forEach((drone) => { drone.state = 'RETURNING'; this.returnRoutes.set(drone.droneId, [drone.homePosition]); });
    this.log('集群安全返航'); this.startClock(); this.publish();
  }
  stop(): void { this.halt(); }
  dispose(): void { this.halt(); this.listener = null; this.returnRoutes.clear(); }
  private move(drone: SwarmDrone, target: Point, delta: number): boolean {
    const from = toLocal(drone.position); const to = toLocal(target); const remaining = distance(from, to);
    const travel = Math.min(remaining, drone.cruiseSpeed * delta);
    if (remaining > 0.01) {
      drone.heading = Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI;
      drone.position = [drone.position[0] + (target[0] - drone.position[0]) * travel / remaining, drone.position[1] + (target[1] - drone.position[1]) * travel / remaining];
      drone.speed = travel / delta;
      drone.battery = Math.max(0, drone.battery - travel * 0.003);
      if (travel > 0) drone.trajectory.push(drone.position);
    }
    return remaining <= travel + 0.01;
  }
  tick(delta: number): void {
    if (!this.config || delta <= 0 || ['COMPLETED', 'ABORTED', 'FAILED'].includes(this.snapshot.status)) return;
    if (this.snapshot.status === 'PAUSED' && !this.snapshot.drones.some((drone) => drone.state === 'RETURNING')) return;
    this.snapshot.elapsed += delta;
    this.snapshot.drones.forEach((drone, index) => {
      if (drone.state === 'TAKING_OFF') {
        if (this.snapshot.elapsed < index * 4) return;
        drone.altitude = Math.min(drone.targetAltitude, drone.altitude + 5 * delta);
        if (drone.altitude === drone.targetAltitude) { drone.state = 'HOLDING'; this.log(`${drone.droneId} 起飞完成，悬停待命`); }
      } else if (drone.state === 'RUNNING') {
        const mission = this.missions.find((item) => item.droneId === drone.droneId);
        const target = mission?.waypoints[drone.waypointIndex];
        if (!target) { drone.state = 'RETURNING'; this.returnRoutes.set(drone.droneId, [drone.homePosition]); return; }
        if (this.move(drone, target, delta)) {
          drone.waypointIndex += 1;
          if (drone.waypointIndex >= 2 && drone.waypointIndex % 2 === 0) drone.completedSegments += 1;
          drone.progress = Math.min(100, drone.completedSegments / (mission?.coverageSegments.length || 1) * 100);
          if (drone.waypointIndex >= (mission?.waypoints.length || 0)) { drone.state = 'RETURNING'; this.returnRoutes.set(drone.droneId, [drone.homePosition]); this.log(`${drone.droneId} 覆盖完成，自动返航`); }
        }
      } else if (drone.state === 'RETURNING') {
        if (this.move(drone, drone.homePosition, delta)) { drone.speed = 0; drone.altitude = Math.max(0, drone.altitude - 5 * delta); if (drone.altitude === 0) { drone.state = 'LANDED'; this.log(`${drone.droneId} 已安全降落`); } }
      }
    });
    const total = this.missions.reduce((sum, mission) => sum + mission.coverageSegments.length, 0);
    this.snapshot.coverage = total ? this.snapshot.drones.reduce((sum, drone) => sum + drone.completedSegments, 0) / total * 100 : 0;
    if (this.snapshot.status === 'TAKING_OFF' && this.snapshot.drones.every((drone) => drone.state === 'HOLDING')) { this.snapshot.status = 'HOLDING'; this.log('机群悬停就绪'); }
    if (this.snapshot.drones.length && this.snapshot.drones.every((drone) => terminal(drone.state))) {
      this.snapshot.status = this.snapshot.coverage >= 99.9 ? 'COMPLETED' : 'ABORTED'; this.log(this.snapshot.status === 'COMPLETED' ? '全部任务完成' : '任务部分完成，安全结束'); this.halt();
    }
    this.publish();
  }
}
