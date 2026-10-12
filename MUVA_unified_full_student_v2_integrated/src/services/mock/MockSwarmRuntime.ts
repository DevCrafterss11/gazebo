import { distance, homes, swarmFrame } from '../../domain/swarmGeometry';
import { shortestRoute, type RoutingBox } from '../../domain/swarmRouting';
import { acceptedMissions, completeMissionPath } from '../../domain/swarmMissionWorkflow';
import type { SwarmService } from '../swarmContract';
import type { Point, SwarmConfig, SwarmDrone, SwarmMission, SwarmMissionReceipt, SwarmSnapshot } from '../../types/swarm';

const clone = (snapshot: SwarmSnapshot): SwarmSnapshot => structuredClone(snapshot);
const terminal = (state: SwarmDrone['state']) => state === 'LANDED';

export class MockSwarmRuntime implements SwarmService {
  readonly mode = 'mock' as const;
  readonly label = '浏览器 Mock';
  private snapshot: SwarmSnapshot = { status: 'DRAFT', drones: [], elapsed: 0, events: [], coverage: 0 };
  private missions: SwarmMission[] = [];
  private config: SwarmConfig | null = null;
  private listener: ((snapshot: SwarmSnapshot) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTime = 0;
  private pendingUpload: { timer: ReturnType<typeof setTimeout>; reject: (error: Error) => void } | null = null;

  initialize(config: SwarmConfig): SwarmSnapshot {
    this.dispose();
    this.config = config;
    this.missions = [];
    const drones: SwarmDrone[] = homes(config.count, undefined, config.sceneOrigin).map((homePosition, index) => ({
      droneId: `UAV-${String(index + 1).padStart(2, '0')}`, displayName: `UAV-${String(index + 1).padStart(2, '0')}`, modelType: 'Iris', sysId: index + 1,
      homePosition, position: homePosition, targetAltitude: config.altitude, cruiseSpeed: config.speed, altitude: 0, speed: 0, heading: 0, battery: 100,
      state: 'READY', waypointIndex: 0, progress: 0, trajectory: [homePosition], completedSegments: 0,
    }));
    this.snapshot = { status: 'DRAFT', drones, elapsed: 0, events: ['Mock 仿真环境已就绪'], coverage: 0 };
    this.publish();
    return this.getStatus();
  }
  restore(config: SwarmConfig, missions: SwarmMission[], snapshot: SwarmSnapshot): SwarmSnapshot {
    this.dispose();
    this.config = structuredClone(config);
    this.missions = structuredClone(missions);
    this.snapshot = clone(snapshot);
    delete this.snapshot.interrupted;
    this.snapshot.drones.filter((drone) => drone.state === 'RETURNING' && !drone.returnWaypoints).forEach((drone) => { drone.returnWaypoints = this.safeReturn(drone); });
    if (['TAKING_OFF', 'HOLDING', 'RUNNING', 'PAUSED', 'RETURNING'].includes(this.snapshot.status)) this.startClock();
    return this.getStatus();
  }
  loadMission(missions: SwarmMission[]): void {
    if (['TAKING_OFF', 'HOLDING', 'RUNNING', 'PAUSED', 'RETURNING'].includes(this.snapshot.status)) throw new Error('飞行中禁止更换航线');
    this.cancelUpload(); this.missions = structuredClone(missions); this.snapshot.status = missions.length ? 'PLANNED' : 'DRAFT'; this.snapshot.missionPlanId = undefined; this.snapshot.missionReceipts = []; this.publish();
  }
  uploadMission(missions: SwarmMission[], planId: string): Promise<SwarmMissionReceipt[]> {
    return new Promise((resolve, reject) => {
      this.ensure(['PLANNED']);
      if (!planId || !this.config || missions.length !== this.snapshot.drones.length || new Set(missions.map((mission) => mission.droneId)).size !== missions.length
        || new Set(missions.map((mission) => mission.missionId)).size !== missions.length || JSON.stringify(missions) !== JSON.stringify(this.missions)) throw new Error('下发任务与当前计划或机群不匹配');
      missions.forEach((mission) => {
        const drone = this.snapshot.drones.find((item) => item.droneId === mission.droneId);
        const path = completeMissionPath(mission, drone);
        if (!drone || !mission.coverageSegments.length || path.length < 3 || path.some((point) => point.some((value) => !Number.isFinite(value)))) throw new Error('下发航线存在无效编号或航点');
      });
      this.cancelUpload();
      const timer = setTimeout(() => {
        this.pendingUpload = null;
        const receivedAt = new Date().toISOString();
        const receipts: SwarmMissionReceipt[] = this.missions.map((mission) => ({ planId, missionId: mission.missionId, droneId: mission.droneId,
          status: 'ACCEPTED', waypointCount: completeMissionPath(mission, this.snapshot.drones.find((drone) => drone.droneId === mission.droneId)).length,
          receivedAt, message: '航线接收成功' }));
        this.snapshot.missionReceipts = receipts;
        this.snapshot.missionPlanId = planId;
        receipts.forEach((receipt) => this.log(`${receipt.droneId} ✓ ${receipt.message}（${receipt.waypointCount} 个完整路径航点）`));
        this.publish(); resolve(structuredClone(receipts));
      }, 240);
      this.pendingUpload = { timer, reject };
    });
  }
  private cancelUpload(): void {
    if (!this.pendingUpload) return;
    clearTimeout(this.pendingUpload.timer); this.pendingUpload.reject(new Error('航线下发已取消：计划或实验发生变化')); this.pendingUpload = null;
  }
  private ensureUploaded(): void {
    if (!this.snapshot.missionPlanId || !acceptedMissions(this.missions, this.snapshot.missionReceipts ?? [], this.snapshot.drones, this.snapshot.missionPlanId)) throw new Error('请先下发航线并确认全部无人机接收成功');
  }
  markReady(): void { this.ensure(['PLANNED', 'READY']); this.ensureUploaded(); this.snapshot.status = 'READY'; this.publish(); }
  getFleet(): SwarmDrone[] { return this.getStatus().drones; }
  getStatus(): SwarmSnapshot { return clone(this.snapshot); }
  subscribeTelemetry(listener: (snapshot: SwarmSnapshot) => void): () => void { this.listener = listener; listener(this.getStatus()); return () => { if (this.listener === listener) this.listener = null; }; }
  private publish(): void { this.listener?.(this.getStatus()); }
  private log(message: string): void { this.snapshot.events = [...this.snapshot.events.slice(-79), `${Math.round(this.snapshot.elapsed)}s · ${message}`]; }
  private ensure(states: SwarmSnapshot['status'][]): void { if (!states.includes(this.snapshot.status)) throw new Error(`当前状态 ${this.snapshot.status} 不允许执行此操作`); }
  private startClock(): void { if (this.timer) return; this.lastTime = performance.now(); this.timer = setInterval(() => { const now = performance.now(); this.tick(Math.min(0.5, (now - this.lastTime) / 1000)); this.lastTime = now; }, 250); }
  private halt(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  takeoff(): void { this.ensure(['READY']); this.ensureUploaded(); this.snapshot.status = 'TAKING_OFF'; this.snapshot.drones.forEach((drone) => { drone.state = 'TAKING_OFF'; }); this.log('机群分时起飞'); this.startClock(); this.publish(); }
  startMission(): void { this.ensure(['HOLDING']); this.snapshot.status = 'RUNNING'; this.snapshot.drones.filter((drone) => drone.state === 'HOLDING').forEach((drone) => { drone.state = 'RUNNING'; }); this.log('开始覆盖任务'); this.publish(); }
  pauseMission(): void { this.ensure(['RUNNING']); this.snapshot.status = 'PAUSED'; this.snapshot.drones.filter((drone) => drone.state === 'RUNNING').forEach((drone) => { drone.state = 'PAUSED'; drone.speed = 0; }); this.log('任务暂停，原地悬停'); this.publish(); }
  resumeMission(): void { this.ensure(['PAUSED']); this.snapshot.status = 'RUNNING'; this.snapshot.drones.filter((drone) => drone.state === 'PAUSED').forEach((drone) => { drone.state = 'RUNNING'; }); this.log('继续覆盖任务'); this.publish(); }
  returnDroneToHome(droneId: string): void {
    this.ensure(['TAKING_OFF', 'HOLDING', 'RUNNING', 'PAUSED', 'RETURNING']);
    const drone = this.snapshot.drones.find((item) => item.droneId === droneId);
    if (!drone || terminal(drone.state) || drone.state === 'RETURNING') throw new Error('该无人机当前无法返航');
    drone.returnWaypoints = this.safeReturn(drone); drone.state = 'RETURNING'; this.log(`${droneId} 单机绕障返航，剩余覆盖任务不再分配`); this.publish();
  }
  returnToHome(): void {
    this.ensure(['TAKING_OFF', 'HOLDING', 'RUNNING', 'PAUSED', 'RETURNING']);
    const routes = this.snapshot.drones.filter((drone) => !terminal(drone.state)).map((drone) => ({ drone, path: this.safeReturn(drone) }));
    this.snapshot.status = 'RETURNING';
    routes.forEach(({ drone, path }) => { drone.state = 'RETURNING'; drone.returnWaypoints = path; });
    this.log('集群安全返航'); this.startClock(); this.publish();
  }
  stop(): void { this.halt(); }
  shutdown(): void { this.dispose(); }
  dispose(): void { this.halt(); this.cancelUpload(); this.listener = null; }
  private safeReturn(drone: SwarmDrone): Point[] {
    const mission = this.missions.find((item) => item.droneId === drone.droneId);
    const { toLocal, toGeo } = swarmFrame(this.config?.sceneOrigin);
    const margin = (this.config?.safety ?? 3) - 0.0001;
    const waiting: RoutingBox[] = this.snapshot.drones.filter((other) => other.droneId !== drone.droneId && other.altitude > .01
      && Math.abs(other.altitude - drone.altitude) < margin).map((other) => {
      const [east, north] = toLocal(other.position);
      return [east - margin, north - margin, east + margin, north + margin];
    });
    return shortestRoute(toLocal(drone.position), toLocal(drone.homePosition), [...(mission?.routingObstacles ?? []), ...waiting]).slice(1).map(toGeo);
  }
  private move(drone: SwarmDrone, target: Point, delta: number): boolean {
    const { toLocal } = swarmFrame(this.config?.sceneOrigin);
    const from = toLocal(drone.position); const to = toLocal(target); const remaining = distance(from, to);
    const travel = Math.min(remaining, drone.cruiseSpeed * delta);
    if (remaining > 0.01) {
      drone.heading = Math.atan2(to[0] - from[0], to[1] - from[1]) * 180 / Math.PI;
      drone.position = [drone.position[0] + (target[0] - drone.position[0]) * travel / remaining, drone.position[1] + (target[1] - drone.position[1]) * travel / remaining];
      drone.speed = travel / delta;
      drone.battery = Math.max(0, drone.battery - travel * 0.003);
      if (travel > 0) drone.trajectory.push(drone.position);
    }
    if (remaining <= travel + 0.01) {
      const atTarget = distance(toLocal(drone.position), to) < 1e-9;
      drone.position = [...target];
      if (!atTarget) drone.trajectory.push(drone.position);
      return true;
    }
    return false;
  }
  tick(delta: number): void {
    if (!this.config || delta <= 0 || ['COMPLETED', 'ABORTED', 'FAILED'].includes(this.snapshot.status)) return;
    if (this.snapshot.status === 'PAUSED' && !this.snapshot.drones.some((drone) => drone.state === 'RETURNING')) return;
    this.snapshot.elapsed += delta;
    const urgentReturn = this.snapshot.drones.find((drone) => drone.state === 'RETURNING'
      && drone.completedSegments < (this.missions.find((mission) => mission.droneId === drone.droneId)?.coverageSegments.length ?? Infinity));
    const entering = this.snapshot.drones.find((drone) => {
      const mission = this.missions.find((item) => item.droneId === drone.droneId);
      return drone.state === 'RUNNING' && mission?.coverageStartIndex !== undefined && drone.waypointIndex <= mission.coverageStartIndex;
    });
    const covering = this.snapshot.drones.some((drone) => drone.state === 'RUNNING' || drone.state === 'PAUSED');
    const transfer = urgentReturn ?? entering ?? (!covering ? this.snapshot.drones.find((drone) => drone.state === 'RETURNING') : undefined);
    this.snapshot.drones.forEach((drone, index) => {
      if (drone.state === 'TAKING_OFF') {
        if (transfer && transfer.droneId !== drone.droneId) { drone.speed = 0; return; }
        if (this.snapshot.elapsed < index * 4) return;
        drone.altitude = Math.min(drone.targetAltitude, drone.altitude + 5 * delta);
        if (drone.altitude === drone.targetAltitude) { drone.state = 'HOLDING'; this.log(`${drone.droneId} 起飞完成，悬停待命`); }
      } else if (drone.state === 'RUNNING') {
        const mission = this.missions.find((item) => item.droneId === drone.droneId);
        if (transfer && transfer.droneId !== drone.droneId) { drone.speed = 0; return; }
        const target = mission?.waypoints[drone.waypointIndex];
        if (!target) { drone.returnWaypoints = this.safeReturn(drone); drone.state = 'RETURNING'; return; }
        if (this.move(drone, target, delta)) {
          drone.waypointIndex += 1;
          if (mission?.coverageWaypointIndices ? mission.coverageWaypointIndices.includes(drone.waypointIndex - 1) : drone.waypointIndex >= 2 && drone.waypointIndex % 2 === 0) drone.completedSegments += 1;
          drone.progress = Math.min(100, drone.completedSegments / (mission?.coverageSegments.length || 1) * 100);
          if (drone.waypointIndex >= (mission?.waypoints.length || 0)) { drone.state = 'RETURNING'; drone.speed = 0; drone.returnWaypoints = mission?.returnPath?.slice(1) ?? this.safeReturn(drone); this.log(`${drone.droneId} 覆盖完成，等待覆盖阶段结束后逐机返航`); }
        }
      } else if (drone.state === 'RETURNING') {
        if (!transfer || transfer.droneId !== drone.droneId) { drone.speed = 0; return; }
        drone.returnWaypoints ??= this.safeReturn(drone);
        const target = drone.returnWaypoints[0];
        if (target && this.move(drone, target, delta)) drone.returnWaypoints.shift();
        if (!drone.returnWaypoints.length) { drone.speed = 0; drone.altitude = Math.max(0, drone.altitude - 5 * delta); if (drone.altitude === 0) { drone.state = 'LANDED'; this.log(`${drone.droneId} 已安全降落`); } }
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
