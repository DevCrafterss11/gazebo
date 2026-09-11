import type { SceneLocation, TrainingScene } from '../../types/configuration';
import type { TelemetrySample } from '../../types/telemetry';

export interface FlightMapAdapter {
  mount(container: HTMLElement): void;
  unmount(): void;
  setScene(scene: TrainingScene): void;
  setHomePoint(home: SceneLocation): void;
  updateVehicle(sample: TelemetrySample): void;
}

export class MockFlightMapAdapter implements FlightMapAdapter {
  private container: HTMLElement | null = null;

  mount(container: HTMLElement): void {
    this.container = container;
  }

  unmount(): void {
    this.container = null;
  }

  setScene(_scene: TrainingScene): void {}
  setHomePoint(_home: SceneLocation): void {}
  updateVehicle(_sample: TelemetrySample): void {}
}
