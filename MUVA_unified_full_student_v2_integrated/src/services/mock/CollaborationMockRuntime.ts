import type { Drone, Mission, Position, TaskStatus } from '../../types/collaboration';

const taskSeeds = [
  { id: 'task-search', name: '区域巡逻', type: '航线巡检', area: '巡逻区 A', description: '编排 UAV-01～03 沿规划航线巡逻并保持区域覆盖。', color: '#16c4ff' },
  { id: 'task-track', name: '目标搜索', type: '搜索与确认', area: '搜索区 B', description: '编排 UAV-04～06 搜索目标、设置目标点并完成确认。', color: '#f6b73c' },
  { id: 'task-inspect', name: '定点监测', type: '定点轮换', area: '监测点 C', description: '编排 UAV-07～09 轮换监测，保持监测点持续在线。', color: '#ae7bff' },
  { id: 'task-relay', name: '物资运输', type: '起降点交付', area: '运输线 D', description: '编排 UAV-10～12 完成运输起点、终点和物资交付。', color: '#39df9a' },
  { id: 'task-transport', name: '应急救援', type: '救援协同', area: '救援点 E', description: '编排 UAV-13～15 前往救援点，并按职责请求协同支援。', color: '#ff6f91' },
] as const;

const groupSeeds = [
  { id: 'group-search', name: '区域巡逻组', taskId: 'task-search' },
  { id: 'group-track', name: '目标搜索组', taskId: 'task-track' },
  { id: 'group-inspect', name: '定点监测组', taskId: 'task-inspect' },
  { id: 'group-relay', name: '物资运输组', taskId: 'task-relay' },
  { id: 'group-transport', name: '应急救援组', taskId: 'task-transport' },
] as const;

const cloneMission = (mission: Mission): Mission => structuredClone(mission);

export const createInitialMission = (): Mission => ({
  tasks: taskSeeds.map((task) => ({ ...task, progress: 0, status: 'WAITING', droneCount: 3 })),
  groups: groupSeeds.map((group, index) => ({
    ...group,
    drones: Array.from({ length: 3 }, (_, droneIndex) => `UAV-${String(index * 3 + droneIndex + 1).padStart(2, '0')}`),
    mode: index === 1 ? 'LEADER' : index === 4 ? 'RELAY' : 'SYNC',
    progress: 0,
    status: 'WAITING',
    color: taskSeeds[index]!.color,
  })),
  drones: Array.from({ length: 15 }, (_, index) => {
    const groupIndex = Math.floor(index / 3);
    const id = `UAV-${String(index + 1).padStart(2, '0')}`;
    return {
      id,
      name: id,
      model: 'Iris 四旋翼',
      endurance: 35 + (index % 3) * 5,
      speed: 8 + (index % 3),
      battery: 100,
      position: { x: (groupIndex - 2) * 42, y: ((index % 3) - 1) * 20, z: 0 },
      status: 'READY',
      taskGroupId: groupSeeds[groupIndex]!.id,
      trajectory: [],
    } satisfies Drone;
  }),
});

const statusForProgress = (progress: number): TaskStatus => progress >= 100 ? 'COMPLETE' : progress > 0 ? 'RUNNING' : 'WAITING';

export const advanceMission = (mission: Mission, activeGroupId?: string): Mission => {
  const next = cloneMission(mission);
  next.groups = next.groups.map((group, groupIndex) => {
    if (activeGroupId && group.id !== activeGroupId) return group;
    const increment = 2.8 + groupIndex * 0.25;
    const progress = Math.min(100, group.progress + increment);
    const status = statusForProgress(progress);
    const task = next.tasks.find((item) => item.id === group.taskId);
    if (task) { task.progress = progress; task.status = status; }
    return { ...group, progress, status };
  });
  next.drones = next.drones.map((drone, index) => {
    if (drone.status === 'FAILED' || activeGroupId && drone.taskGroupId !== activeGroupId) return drone;
    const group = next.groups.find((item) => item.id === drone.taskGroupId);
    const progress = group?.progress ?? 0;
    const phase = (index % 3) * 0.8 + progress / 16;
    const groupIndex = Math.floor(index / 3);
    const position: Position = {
      x: (groupIndex - 2) * 42 + Math.cos(phase) * 5,
      y: ((index % 3) - 1) * 20 + Math.sin(phase) * 5,
      z: Math.min(24, drone.position.z + 1.5),
    };
    return {
      ...drone,
      position,
      battery: Math.max(12, drone.battery - drone.speed * 0.018),
      status: progress >= 100 ? 'COMPLETE' : 'RUNNING',
      trajectory: [...drone.trajectory.slice(-36), position],
    };
  });
  return next;
};

export class CollaborationMockRuntime {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(getMission: () => Mission, onUpdate: (mission: Mission) => void, groupId?: string): void {
    this.stop();
    this.timer = setInterval(() => {
      onUpdate(advanceMission(getMission(), groupId));
    }, 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export const collaborationTaskSeeds = taskSeeds;
