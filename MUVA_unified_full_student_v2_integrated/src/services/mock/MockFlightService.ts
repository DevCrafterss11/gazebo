import { assertBeforeArm, assertBeforeLand, assertBeforeRtl, assertBeforeTakeoff } from '../../domain/flightSafety';
import type { FlightService } from '../contracts';
import { mockDroneSimulator } from './MockDroneSimulator';

export class MockFlightService implements FlightService {
  async initialize(home: { latitude: number; longitude: number }, maxAltitudeMeters?: number): Promise<void> {
    mockDroneSimulator.initialize(home, maxAltitudeMeters);
  }
  getState() {
    return mockDroneSimulator.getState();
  }

  async beforeArmCheck(): Promise<void> { assertBeforeArm(mockDroneSimulator.getSafetyContext()); }
  async beforeTakeoffCheck(altitudeMeters: number): Promise<void> { assertBeforeTakeoff(mockDroneSimulator.getSafetyContext(), altitudeMeters); }
  async beforeLandCheck(): Promise<void> { assertBeforeLand(mockDroneSimulator.getSafetyContext()); }
  async beforeRtlCheck(): Promise<void> { assertBeforeRtl(mockDroneSimulator.getSafetyContext()); }

  async arm(): Promise<void> { mockDroneSimulator.arm(); }
  async disarm(): Promise<void> { mockDroneSimulator.disarm(); }
  async takeoff(altitudeMeters: number): Promise<void> { mockDroneSimulator.takeoff(altitudeMeters); }
  async ascend(): Promise<void> { mockDroneSimulator.move('up', 1); }
  async descend(): Promise<void> { mockDroneSimulator.move('down', 1); }
  async moveForward(): Promise<void> { mockDroneSimulator.move('forward', 5); }
  async moveBackward(): Promise<void> { mockDroneSimulator.move('backward', 5); }
  async moveLeft(): Promise<void> { mockDroneSimulator.move('left', 5); }
  async moveRight(): Promise<void> { mockDroneSimulator.move('right', 5); }
  async yawLeft(): Promise<void> { mockDroneSimulator.yaw('left', 15); }
  async yawRight(): Promise<void> { mockDroneSimulator.yaw('right', 15); }
  async land(): Promise<void> { mockDroneSimulator.land(); }
  async rtl(): Promise<void> { mockDroneSimulator.rtl(); }
  async hold(): Promise<void> { mockDroneSimulator.hold(); }
  async move(direction: 'forward' | 'backward' | 'left' | 'right' | 'up' | 'down', meters: number): Promise<void> {
    mockDroneSimulator.move(direction, meters);
  }
  async yaw(direction: 'left' | 'right', degrees: number): Promise<void> { mockDroneSimulator.yaw(direction, degrees); }
  async setMode(mode: 'GUIDED' | 'STABILIZE' | 'LOITER'): Promise<void> { mockDroneSimulator.setMode(mode); }
}
