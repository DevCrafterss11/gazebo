import type { SceneLocation } from '../../types/configuration';
import type { SimulatedDroneState } from '../../types/simulator';
import { assertBeforeArm, assertBeforeControl, assertBeforeLand, assertBeforeRtl, assertBeforeTakeoff, type FlightSafetyContext } from '../../domain/flightSafety';

type StateListener = (state: SimulatedDroneState) => void;

const tickMilliseconds = 200;
const tickSeconds = tickMilliseconds / 1_000;
const metersPerLatitudeDegree = 111_111;

const approach = (value: number, target: number, delta: number): number => {
  const difference = target - value;
  return Math.abs(difference) <= delta ? target : value + Math.sign(difference) * delta;
};

const normalizeYaw = (yaw: number): number => ((yaw % 360) + 360) % 360;

const cloneState = (state: SimulatedDroneState): SimulatedDroneState => ({
  ...state,
  position: { ...state.position }, homePosition: { ...state.homePosition }, targetPosition: { ...state.targetPosition },
  velocity: { ...state.velocity }, attitude: { ...state.attitude },
  ekfStatus: { ...state.ekfStatus }, mavlinkStatus: { ...state.mavlinkStatus },
  health: { ekfStatus: { ...state.health.ekfStatus }, mavlinkStatus: { ...state.health.mavlinkStatus } },
});

export class MockDroneSimulator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly listeners = new Set<StateListener>();
  private tickIndex = 0;
  private maxAltitudeMeters = 120;
  private state: SimulatedDroneState;

  constructor() {
    this.state = this.createInitialState({ latitude: 34.3416, longitude: 108.9398 });
  }

  initialize(home: SceneLocation, maxAltitudeMeters = 120): void {
    this.maxAltitudeMeters = maxAltitudeMeters;
    this.tickIndex = 0;
    this.state = this.createInitialState(home);
    this.emit();
  }

  start(): void {
    if (this.timer) return;
    this.state = this.withDerived({
      ...this.state,
      connected: true,
      mavlinkConnected: true,
      mavlinkStatus: { ...this.state.mavlinkStatus, connected: true, heartbeat: true },
    });
    this.timer = setInterval(() => this.update(), tickMilliseconds);
    this.emit();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.state = this.withDerived({
      ...this.state,
      connected: false,
      mavlinkConnected: false,
      mavlinkStatus: { ...this.state.mavlinkStatus, connected: false, heartbeat: false },
    });
    this.emit();
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  getState(): SimulatedDroneState { return cloneState(this.state); }

  arm(): void {
    assertBeforeArm(this.getSafetyContext());
    if (this.state.flightState === 'landing') throw new Error('正在降落，不能 ARM');
    this.state = this.withDerived({ ...this.state, armed: true, mode: 'GUIDED', flightState: 'armed' });
    this.emit();
  }

  disarm(): void {
    if (this.state.altitude > 0.2) throw new Error('飞行中禁止直接 DISARM，请先 LAND');
    this.state = this.withDerived({ ...this.state, armed: false, flightState: 'grounded' });
    this.emit();
  }

  takeoff(altitudeMeters: number): void {
    assertBeforeTakeoff(this.getSafetyContext(), altitudeMeters);
    if (this.state.altitude > 0.2) throw new Error('无人机已经离地，不能重复 TAKEOFF');
    this.state = this.withDerived({ ...this.state, mode: 'GUIDED', targetAltitude: Math.max(1, altitudeMeters), flightState: 'taking-off' });
    this.emit();
  }

  land(): void {
    assertBeforeLand(this.getSafetyContext());
    if (this.state.flightState === 'landing') throw new Error('无人机已经处于 LANDING 状态');
    this.state = this.withDerived({ ...this.state, mode: 'LAND', targetAltitude: 0, targetPosition: { ...this.state.position, altitude: 0 }, flightState: 'landing' });
    this.emit();
  }

  rtl(): void {
    assertBeforeRtl(this.getSafetyContext());
    this.state = this.withDerived({ ...this.state, mode: 'RTL', targetPosition: { ...this.state.homePosition, altitude: this.state.altitude }, flightState: 'returning' });
    this.emit();
  }

  hold(): void {
    assertBeforeControl(this.getSafetyContext());
    if (!this.state.armed || this.state.altitude < 0.2) throw new Error('无人机尚未起飞，无法 HOLD');
    this.state = this.withDerived({ ...this.state, mode: 'LOITER', targetAltitude: this.state.altitude, targetPosition: { ...this.state.position }, flightState: 'holding' });
    this.emit();
  }

  move(direction: 'forward' | 'backward' | 'left' | 'right' | 'up' | 'down', meters: number): void {
    assertBeforeControl(this.getSafetyContext());
    if (!this.state.armed || this.state.altitude < 0.2) throw new Error('无人机尚未起飞');
    if (this.state.flightState === 'landing') throw new Error('正在降落，不能继续操控');
    if (direction === 'up' || direction === 'down') {
      const requestedAltitude = this.state.targetAltitude + (direction === 'up' ? meters : -meters);
      if (requestedAltitude > this.maxAltitudeMeters) throw new Error(`已达到最大高度 ${this.maxAltitudeMeters} m`);
      this.state = this.withDerived({ ...this.state, mode: 'GUIDED', targetAltitude: Math.max(0.5, requestedAltitude), flightState: 'flying' });
    } else {
      const latitudeMeters = direction === 'forward' ? meters : direction === 'backward' ? -meters : 0;
      const longitudeMeters = direction === 'right' ? meters : direction === 'left' ? -meters : 0;
      const longitudeScale = metersPerLatitudeDegree * Math.cos((this.state.latitude * Math.PI) / 180);
      this.state = this.withDerived({ ...this.state, mode: 'GUIDED', targetPosition: {
        ...this.state.targetPosition,
        latitude: this.state.targetPosition.latitude + latitudeMeters / metersPerLatitudeDegree,
        longitude: this.state.targetPosition.longitude + longitudeMeters / longitudeScale,
      }, flightState: 'flying' });
    }
    this.emit();
  }

  yaw(direction: 'left' | 'right', degrees: number): void {
    assertBeforeControl(this.getSafetyContext());
    if (!this.state.armed) throw new Error('无人机未解锁，不能偏航');
    this.state = this.withDerived({ ...this.state, mode: 'GUIDED', targetYaw: normalizeYaw(this.state.targetYaw + (direction === 'right' ? degrees : -degrees)) });
    this.emit();
  }

  setMode(mode: 'GUIDED' | 'STABILIZE' | 'LOITER'): void {
    assertBeforeControl(this.getSafetyContext());
    this.state = this.withDerived({ ...this.state, mode });
    this.emit();
  }

  private createInitialState(home: SceneLocation): SimulatedDroneState {
    const position = { latitude: home.latitude, longitude: home.longitude, altitude: 0 };
    return this.withDerived({
      armed: false, mode: 'GUIDED', latitude: position.latitude, longitude: position.longitude, homeLatitude: position.latitude, homeLongitude: position.longitude,
      altitude: 0, north: 0, east: 0, vx: 0, vy: 0, vz: 0, groundSpeed: 0, roll: 0, pitch: 0, yaw: 0, battery: 100,
      gpsSatellites: 16, ekfHealthy: true, mavlinkConnected: false,
      ekfStatus: { healthy: true, state: 'NORMAL' },
      mavlinkStatus: { connected: false, heartbeat: false, version: 'MAVLink 2' },
      health: { ekfStatus: { healthy: true, state: 'NORMAL' }, mavlinkStatus: { connected: false, heartbeat: false, version: 'MAVLink 2' } },
      position, homePosition: { ...position }, velocity: { vx: 0, vy: 0, vz: 0 },
      attitude: { roll: 0, pitch: 0, yaw: 0 }, batteryPercent: 100, ekfOk: true, connected: false, targetAltitude: 0,
      targetPosition: { ...position }, targetYaw: 0, flightState: 'grounded',
    });
  }

  private update(): void {
    this.tickIndex += 1;
    const previous = this.state;
    const climbRate = previous.flightState === 'landing' ? 1.6 : 2.2;
    const altitude = approach(previous.altitude, previous.targetAltitude, climbRate * tickSeconds);
    const longitudeScale = metersPerLatitudeDegree * Math.cos((previous.latitude * Math.PI) / 180);
    const northDistance = (previous.targetPosition.latitude - previous.latitude) * metersPerLatitudeDegree;
    const eastDistance = (previous.targetPosition.longitude - previous.longitude) * longitudeScale;
    const distance = Math.hypot(northDistance, eastDistance);
    const targetSpeed = distance > 0.08 ? 3 : 0;
    const horizontalSpeed = approach(previous.groundSpeed, targetSpeed, 2.2 * tickSeconds);
    const travel = Math.min(distance, horizontalSpeed * tickSeconds);
    const northStep = distance > 0 ? northDistance / distance * travel : 0;
    const eastStep = distance > 0 ? eastDistance / distance * travel : 0;
    const yaw = normalizeYaw(approach(previous.yaw, previous.targetYaw, 38 * tickSeconds));
    const landed = previous.flightState === 'landing' && altitude <= 0.01;
    const reachedAltitude = Math.abs(altitude - previous.targetAltitude) < 0.03;
    const reachedHome = previous.flightState === 'returning' && distance < 0.35 && horizontalSpeed < 0.12;
    const flightState = landed ? 'grounded' : previous.flightState === 'taking-off' && reachedAltitude ? 'holding' : reachedHome ? 'holding' : previous.flightState;
    const hoverWave = flightState === 'holding' && previous.altitude > 0.2 ? Math.sin(this.tickIndex * 0.41) * 0.025 : 0;
    const nextPosition = { latitude: previous.latitude + northStep / metersPerLatitudeDegree, longitude: previous.longitude + eastStep / longitudeScale, altitude: landed ? 0 : Math.max(0, altitude + hoverWave) };
    const velocity = { vx: northStep / tickSeconds, vy: eastStep / tickSeconds, vz: (nextPosition.altitude - previous.altitude) / tickSeconds };
    const attitude = { roll: approach(previous.roll, velocity.vy * 1.5 + Math.sin(this.tickIndex * 0.23) * 0.18, 0.8), pitch: approach(previous.pitch, -velocity.vx * 1.5 + Math.cos(this.tickIndex * 0.19) * 0.14, 0.8), yaw };
    this.state = this.withDerived({ ...previous, armed: landed ? false : previous.armed, mode: landed ? 'LAND' : previous.mode, position: nextPosition, velocity, groundSpeed: horizontalSpeed, attitude, batteryPercent: Math.max(0, previous.batteryPercent - (previous.armed ? 0.006 : 0.0002)), flightState });
    this.emit();
  }

  private withDerived(state: SimulatedDroneState): SimulatedDroneState {
    const health = { ekfStatus: { ...state.ekfStatus }, mavlinkStatus: { ...state.mavlinkStatus } };
    const latitudeScale = metersPerLatitudeDegree;
    const longitudeScale = metersPerLatitudeDegree * Math.cos((state.homePosition.latitude * Math.PI) / 180);
    return {
      ...state,
      health,
      latitude: state.position.latitude,
      longitude: state.position.longitude,
      homeLatitude: state.homePosition.latitude,
      homeLongitude: state.homePosition.longitude,
      altitude: state.position.altitude,
      north: (state.position.latitude - state.homePosition.latitude) * latitudeScale,
      east: (state.position.longitude - state.homePosition.longitude) * longitudeScale,
      vx: state.velocity.vx,
      vy: state.velocity.vy,
      vz: state.velocity.vz,
      roll: state.attitude.roll,
      pitch: state.attitude.pitch,
      yaw: state.attitude.yaw,
      battery: state.batteryPercent,
      ekfHealthy: state.ekfStatus.healthy,
      ekfOk: state.ekfStatus.healthy,
      mavlinkConnected: state.mavlinkStatus.connected,
      connected: state.mavlinkStatus.connected,
    };
  }

  getSafetyContext(): FlightSafetyContext {
    return {
      environmentReady: this.state.mavlinkStatus.connected,
      vehicleOnline: this.state.mavlinkStatus.connected,
      mavlinkConnected: this.state.mavlinkStatus.connected && this.state.mavlinkStatus.heartbeat,
      ekfHealthy: this.state.ekfStatus.healthy,
      gpsSatellites: this.state.gpsSatellites,
      batteryPercent: this.state.batteryPercent,
      armed: this.state.armed,
      altitude: this.state.altitude,
      maxAltitude: this.maxAltitudeMeters,
      homePosition: this.state.homePosition,
    };
  }

  private emit(): void { const snapshot = this.getState(); this.listeners.forEach((listener) => listener(snapshot)); }
}

export const mockDroneSimulator = new MockDroneSimulator();
