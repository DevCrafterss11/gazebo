import { create } from 'zustand';

import { services } from '../services/serviceRegistry';
import type { EnvironmentLogEntry, EnvironmentRuntimeStatus, EnvironmentStartRequest, EnvironmentStartupState } from '../types/environment';
import { useFlightStore } from './flightStore';
import { useNotificationStore } from './notificationStore';
import { useTelemetryStore } from './telemetryStore';

interface EnvironmentState {
  startup: EnvironmentStartupState;
  runtime: EnvironmentRuntimeStatus;
  logs: EnvironmentLogEntry[];
  isStarting: boolean;
  initialize: () => void;
  start: (request: EnvironmentStartRequest) => Promise<void>;
  stop: () => Promise<void>;
}

let environmentSubscription: (() => void) | null = null;

export const useEnvironmentStore = create<EnvironmentState>((set) => ({
  startup: { phase: 'IDLE', progress: 0, message: '等待启动' },
  runtime: {
    gazebo: 'STOPPED',
    ardupilotSitl: 'STOPPED',
    mavlinkGateway: 'DISCONNECTED',
    heartbeat: 'WAITING',
    gps: 'WAITING',
    ekf: 'WAITING',
    vehicle: 'UNAVAILABLE',
  },
  logs: [],
  isStarting: false,
  initialize: () => {
    if (environmentSubscription) return;
    environmentSubscription = services.environment.subscribe((startup, runtime, logs) => {
      set({ startup, runtime, logs, isStarting: startup.phase !== 'READY' && startup.phase !== 'IDLE' && startup.phase !== 'ERROR' });
    });
  },
  start: async (request) => {
    set({ isStarting: true });
    try {
      await services.environment.startEnvironment(request);
      useNotificationStore.getState().addNotification({
        title: '实验环境启动成功',
        detail: 'Gazebo、ArduPilot SITL 与 MAVLink Gateway 已进入就绪状态。',
        kind: 'environment',
      });
      useNotificationStore.getState().addNotification({
        title: 'GPS 已获得 3D Fix',
        detail: '定位与 EKF 状态健康，可以开始基础飞行训练。',
        kind: 'environment',
      });
    } finally {
      set({ isStarting: false });
    }
  },
  stop: async () => {
    await services.environment.stopEnvironment();
    useTelemetryStore.getState().disconnect();
    useFlightStore.getState().setDisconnected();
    set({ isStarting: false });
    useNotificationStore.getState().addNotification({
      title: '仿真环境已停止',
      detail: '遥测连接已安全断开，当前飞行控制不可用。',
      kind: 'environment',
    });
  },
}));
