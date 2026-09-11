import { mockTelemetry } from '../mocks/telemetry';
import type { TelemetrySample } from '../types/telemetry';

export interface TelemetryApi {
  getLatest(): Promise<TelemetrySample>;
  getHistory(): Promise<TelemetrySample[]>;
}

export const telemetryApi: TelemetryApi = {
  async getLatest() {
    const latest = mockTelemetry.at(-1);

    if (!latest) {
      throw new Error('Mock telemetry is empty.');
    }

    return latest;
  },
  async getHistory() {
    return mockTelemetry;
  },
};
