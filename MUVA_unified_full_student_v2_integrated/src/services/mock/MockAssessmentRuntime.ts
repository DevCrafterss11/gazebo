import { scenes, type AssessmentConfig, type Fault, type SimulationSnapshot } from '../../domain/assessment/model';
import type { TelemetrySample } from '../../types/telemetry';

export interface AssessmentRuntime {
  subscribe(handler: (snapshot: SimulationSnapshot) => void): () => void;
  snapshot(): SimulationSnapshot;
  telemetry(): TelemetrySample;
  start(config: AssessmentConfig, sceneId?: string): void;
  stop(): void;
  command(action: string, value?: number | { x: number; z: number }): void;
  setFault(fault: Fault): void;
  step(seconds: number): void;
}
const origin = { latitude: 34.1251589, longitude: 108.8289653 };
const initial = (): SimulationSnapshot => ({ position: { x: 0, y: 0, z: 0 }, attitude: { roll: 0, pitch: 0, yaw: 0 }, velocity: { vx: 0, vy: 0, vz: 0 }, battery: 100, armed: false, airborne: false, mode: 'GUIDED', flightStatus: 'STOPPED', homePosition: { x: 0, y: 0, z: 0 }, targetPosition: { x: 0, y: 0, z: 0 }, telemetryTimestamp: 0, paused: false });
const approach = (current: number, target: number, amount: number) => current + Math.sign(target - current) * Math.min(Math.abs(target - current), amount);
const headingDifference = (current: number, target: number) => ((target - current + 540) % 360) - 180;
export class MockAssessmentRuntime implements AssessmentRuntime {
  private state = initial();
  private listeners = new Set<(snapshot: SimulationSnapshot) => void>();
  private frame = 0;
  private last = 0;
  private speed = 3;
  private targetYaw = 0;
  private fault: Fault = 'normal';
  private sceneId = 'runway';
  private lastEmitted = 0;
  snapshot(): SimulationSnapshot { return { ...this.state, position: { ...this.state.position }, attitude: { ...this.state.attitude }, velocity: { ...this.state.velocity }, targetPosition: { ...this.state.targetPosition } }; }
  subscribe(handler: (snapshot: SimulationSnapshot) => void): () => void { this.listeners.add(handler); handler(this.snapshot()); return () => this.listeners.delete(handler); }
  private emit(): void { const snapshot = this.snapshot(); this.listeners.forEach((handler) => handler(snapshot)); }
  telemetry(): TelemetrySample {
    const { position, attitude, velocity, battery, armed, mode, flightStatus, telemetryTimestamp } = this.state;
    return { timestamp: telemetryTimestamp, source: 'simulation', position: { latitude: origin.latitude - position.z / 111111, longitude: origin.longitude + position.x / (111111 * Math.cos(origin.latitude * Math.PI / 180)), altitude: position.y }, attitude: { ...attitude }, speedMetersPerSecond: Math.hypot(velocity.vx, velocity.vz), batteryPercent: this.fault === 'battery' ? Math.min(15, battery) : battery, gpsSatellites: this.fault === 'gps' ? 2 : 16, ekfStatus: { healthy: this.fault !== 'ekf', state: this.fault === 'ekf' ? 'ERROR' : 'HEALTHY' }, mavlinkStatus: { connected: this.fault !== 'link', heartbeat: this.fault !== 'link', version: 'Mock' }, armed, mode, flightState: flightStatus === 'LANDED' ? 'grounded' : flightStatus.toLowerCase(), north: -position.z, east: position.x };
  }
  start(config: AssessmentConfig, sceneId = 'runway'): void { const scene = scenes.find((item) => item.id === sceneId && item.available); if (!scene) throw new Error('训练场景不可用'); this.stop(); this.state = initial(); this.state.position = { ...scene.homePosition }; this.state.homePosition = { ...scene.homePosition }; this.state.targetPosition = { ...scene.homePosition }; this.state.flightStatus = 'GROUNDED'; this.state.mode = config.mode; this.state.telemetryTimestamp = Date.now(); this.speed = config.speed; this.sceneId = sceneId; this.fault = 'normal'; this.targetYaw = 0; this.lastEmitted = 0; this.emit(); this.last = 0; this.frame = requestAnimationFrame(this.tick); }
  stop(): void { if (this.frame) cancelAnimationFrame(this.frame); this.frame = 0; this.state = initial(); this.emit(); }
  setFault(fault: Fault): void { this.fault = fault; if (fault === 'link') this.state.telemetryTimestamp = 0; else this.state.telemetryTimestamp = Date.now(); this.emit(); }
  command(action: string, value?: number | { x: number; z: number }): void {
    if (this.state.flightStatus === 'STOPPED') throw new Error('模拟环境未就绪');
    if (action === 'pause' || action === 'resume') { this.state.paused = action === 'pause'; this.emit(); return; }
    if (action === 'guided') { if (this.state.armed) throw new Error('已解锁不可切换模式'); this.state.mode = 'GUIDED'; this.emit(); return; }
    if (this.state.paused) throw new Error('模拟已暂停');
    if (this.fault !== 'normal' && !['land', 'rtl'].includes(action)) throw new Error('请先修复模拟传感器/通信异常');
    const previous = this.snapshot();
    const previousYaw = this.targetYaw;
    if (action === 'arm') { if (this.state.armed || this.state.airborne) throw new Error('已解锁或正在飞行'); this.state.armed = true; this.state.flightStatus = 'ARMED'; }
    else if (action === 'disarm') { if (this.state.airborne) throw new Error('飞行中不可直接上锁'); this.state.armed = false; this.state.flightStatus = 'GROUNDED'; }
    else {
      if (!this.state.armed) throw new Error('请先完成安全检查与解锁');
      if (action === 'takeoff') { if (this.state.airborne) throw new Error('已经起飞'); this.state.targetPosition.y = Number(value) || 10; this.state.flightStatus = 'TAKING_OFF'; }
      else if (!this.state.airborne) throw new Error('请先起飞');
      else if (action === 'hover') { this.state.targetPosition = { ...this.state.position }; this.state.flightStatus = 'HOVERING'; }
      else if (action === 'altitude') { this.state.targetPosition.y = Number(value); this.state.flightStatus = 'MOVING'; }
      else if (action === 'forward' || action === 'backward' || action === 'right' || action === 'left') {
        const distance = Number(value) || 5; const radians = this.state.attitude.yaw * Math.PI / 180;
        const forward = action === 'forward' ? 1 : action === 'backward' ? -1 : 0;
        const sideways = action === 'right' ? 1 : action === 'left' ? -1 : 0;
        this.state.targetPosition.x += (Math.sin(radians) * forward + Math.cos(radians) * sideways) * distance;
        this.state.targetPosition.z += (-Math.cos(radians) * forward + Math.sin(radians) * sideways) * distance;
        this.state.flightStatus = 'MOVING';
      } else if (action === 'waypoint') { if (!value || typeof value === 'number') throw new Error('航点无效'); this.state.targetPosition.x = value.x; this.state.targetPosition.z = value.z; this.state.flightStatus = 'MOVING'; }
      else if (action === 'yaw') { this.targetYaw = (this.state.attitude.yaw + Number(value) + 360) % 360; this.state.flightStatus = 'TURNING'; }
      else if (action === 'rtl') { this.state.targetPosition = { ...this.state.homePosition, y: Math.max(this.state.position.y, 5) }; this.state.mode = 'RTL'; this.state.flightStatus = 'RETURNING'; }
      else if (action === 'land') { this.state.targetPosition = { ...this.state.position, y: 0 }; this.state.mode = 'LAND'; this.state.flightStatus = 'LANDING'; }
      else throw new Error('未知模拟指令');
    }
    const scene = scenes.find((item) => item.id === this.sceneId)!;
    if (Math.abs(this.state.targetPosition.x - scene.homePosition.x) > scene.trainingArea.width / 2 || Math.abs(this.state.targetPosition.z - scene.homePosition.z) > scene.trainingArea.length / 2) {
      this.state = previous;
      this.targetYaw = previousYaw;
      throw new Error(`目标超出 ${this.sceneId} 模拟安全区域`);
    }
    this.emit();
  }
  step(seconds: number): void {
    if (this.state.paused || this.state.flightStatus === 'STOPPED') return;
    const delta = Math.min(0.08, Math.max(0, seconds));
    const current = this.state.position; const target = this.state.targetPosition;
    const horizontal = Math.hypot(target.x - current.x, target.z - current.z);
    const travel = Math.min(horizontal, this.speed * delta);
    const nextX = horizontal ? current.x + (target.x - current.x) / horizontal * travel : current.x;
    const nextZ = horizontal ? current.z + (target.z - current.z) / horizontal * travel : current.z;
    const nextY = approach(current.y, target.y, 2 * delta);
    const yawDelta = headingDifference(this.state.attitude.yaw, this.targetYaw);
    const nextYaw = (this.state.attitude.yaw + Math.sign(yawDelta) * Math.min(Math.abs(yawDelta), 75 * delta) + 360) % 360;
    this.state.velocity = { vx: delta ? (nextX - current.x) / delta : 0, vy: delta ? (nextY - current.y) / delta : 0, vz: delta ? (nextZ - current.z) / delta : 0 };
    this.state.position = { x: nextX, y: nextY, z: nextZ };
    this.state.attitude = { yaw: nextYaw, roll: approach(this.state.attitude.roll, Math.max(-12, Math.min(12, this.state.velocity.vx * 3)), 20 * delta), pitch: approach(this.state.attitude.pitch, Math.max(-12, Math.min(12, this.state.velocity.vz * 3)), 20 * delta) };
    this.state.airborne = nextY > 0.15;
    if (this.state.flightStatus === 'RETURNING' && Math.hypot(nextX - this.state.homePosition.x, nextZ - this.state.homePosition.z) < 0.25) { this.state.targetPosition = { ...this.state.homePosition }; this.state.flightStatus = 'LANDING'; }
    if (this.state.flightStatus === 'LANDING' && nextY < 0.05) { this.state.position.y = 0; this.state.armed = false; this.state.airborne = false; this.state.flightStatus = 'LANDED'; }
    if (this.state.flightStatus === 'TAKING_OFF' && Math.abs(nextY - target.y) < 0.12) this.state.flightStatus = 'HOVERING';
    if ((this.state.flightStatus === 'MOVING' || this.state.flightStatus === 'TURNING') && horizontal < 0.08 && Math.abs(nextY - target.y) < 0.08 && Math.abs(headingDifference(nextYaw, this.targetYaw)) < 2) this.state.flightStatus = 'HOVERING';
    if (this.state.armed) this.state.battery = Math.max(0, this.state.battery - 0.012 * delta);
    if (this.fault !== 'link') this.state.telemetryTimestamp = Date.now();
    if (Date.now() - this.lastEmitted > 90 || this.state.flightStatus === 'LANDED') { this.lastEmitted = Date.now(); this.emit(); }
  }
  private tick = (timestamp: number): void => {
    if (!this.frame) return;
    if (this.last) this.step((timestamp - this.last) / 1000);
    this.last = timestamp;
    this.frame = requestAnimationFrame(this.tick);
  };
}
export const assessmentRuntime: AssessmentRuntime = new MockAssessmentRuntime();
