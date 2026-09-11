import { create } from 'zustand';

import { services, type DataSource, type RuntimeCapabilities } from '../services/serviceRegistry';

interface SystemState {
  capabilities: RuntimeCapabilities;
  dataSource: DataSource;
  interfaceVersion: string;
  telemetryRefreshRate: string;
  simulationMode: string;
}

export const useSystemStore = create<SystemState>(() => ({
  capabilities: services.capabilities,
  dataSource: services.capabilities.dataSource,
  interfaceVersion: 'MUVA Demo 0.1.0',
  telemetryRefreshRate: services.capabilities.supportsRealtimeTelemetry ? '实时推送' : '不可用',
  simulationMode: '仿真教学环境',
}));
