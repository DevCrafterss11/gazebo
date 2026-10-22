export type DroneStatus = 'WAITING' | 'READY' | 'RUNNING' | 'COMPLETE' | 'FAILED';
export type TaskStatus = 'WAITING' | 'RUNNING' | 'COMPLETE' | 'FAILED';
export type CollaborationMode = 'SYNC' | 'RELAY' | 'LEADER';
export type FailureType = 'DISCONNECT' | 'LOW_BATTERY';

export interface Position {
  x: number;
  y: number;
  z: number;
}

export interface Drone {
  id: string;
  name: string;
  model: string;
  endurance: number;
  speed: number;
  battery: number;
  position: Position;
  status: DroneStatus;
  taskGroupId: string;
  trajectory: Position[];
}

export interface Task {
  id: string;
  name: string;
  type: string;
  area: string;
  progress: number;
  status: TaskStatus;
  description: string;
  droneCount: number;
  color: string;
}

export interface TaskGroup {
  id: string;
  name: string;
  taskId: string;
  drones: string[];
  mode: CollaborationMode;
  progress: number;
  status: TaskStatus;
  color: string;
}

export interface Mission {
  tasks: Task[];
  groups: TaskGroup[];
  drones: Drone[];
}

export interface CollaborationFailure {
  type: FailureType;
  droneId: string;
  title: string;
  impact: string;
  resolved: boolean;
}

export interface CollaborationScore {
  completion: number;
  duration: number;
  coordination: number;
  response: number;
  total: number;
}

export const collaborationModeLabels: Record<CollaborationMode, { label: string; description: string; suitable: string }> = {
  SYNC: { label: '同步执行', description: '多个无人机同时执行任务，便于快速覆盖目标区域。', suitable: '适合区域搜索' },
  RELAY: { label: '接力执行', description: '无人机按照顺序交接任务，保持长距离巡检连续性。', suitable: '适合长距离巡检' },
  LEADER: { label: '主辅协同', description: '一个主无人机负责规划，其他无人机辅助执行和观察。', suitable: '适合目标跟踪' },
};
