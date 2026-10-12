import { distance, swarmFrame } from './swarmGeometry';
import { minimumCoverageRectangle } from './swarmCoverage';
import { assertPlanningSafe } from './swarmPlanning';
import type { Point, SwarmCheck, SwarmDeliveryStatus, SwarmDrone, SwarmMission, SwarmMissionReceipt, SwarmRun } from '../types/swarm';

export const deliveryLabels: Record<SwarmDeliveryStatus, string> = {
  UNPLANNED: '未规划', GENERATED: '已生成航线', CHECKED: '航线检查通过', UPLOADING: '正在下发', UPLOADED: '已下发', WAITING_TAKEOFF: '等待起飞',
};

export function completeMissionPath(mission: SwarmMission, drone?: SwarmDrone): Point[] {
  const first = mission.entryPath?.[0] ?? drone?.trajectory[0] ?? drone?.homePosition;
  const points = [...(first ? [first] : []), ...mission.waypoints,
    ...(mission.returnPath?.slice(1) ?? (drone ? [drone.homePosition] : []))];
  return points.filter((point, index) => index === 0 || Math.abs(point[0] - points[index - 1]![0]) > 1e-10 || Math.abs(point[1] - points[index - 1]![1]) > 1e-10);
}

export function acceptedMissions(missions: SwarmMission[], receipts: SwarmMissionReceipt[], fleet: SwarmDrone[], planId?: string): boolean {
  return missions.length > 0 && receipts.length === missions.length && new Set(receipts.map((receipt) => receipt.droneId)).size === missions.length
    && missions.every((mission) => {
      const receipt = receipts.find((item) => item.missionId === mission.missionId && item.droneId === mission.droneId);
      return receipt?.status === 'ACCEPTED' && (!planId || receipt.planId === planId)
        && receipt.waypointCount === completeMissionPath(mission, fleet.find((drone) => drone.droneId === mission.droneId)).length;
    });
}

export function deliveryStatus(run: SwarmRun): SwarmDeliveryStatus {
  if (!run.missions.length) return 'UNPLANNED';
  return run.delivery?.status ?? 'GENERATED';
}

export function missionUploaded(run: SwarmRun): boolean {
  return !!run.delivery && ['UPLOADED', 'WAITING_TAKEOFF'].includes(run.delivery.status)
    && run.snapshot?.missionPlanId === run.delivery.planId
    && acceptedMissions(run.missions, run.delivery.receipts, run.snapshot?.drones ?? [], run.delivery.planId)
    && acceptedMissions(run.missions, run.snapshot?.missionReceipts ?? [], run.snapshot?.drones ?? [], run.delivery.planId);
}

export function checkMissionPlan(run: SwarmRun): SwarmCheck[] {
  const { toLocal } = swarmFrame(run.config.sceneOrigin);
  const fleet = run.snapshot?.drones ?? [];
  const checks: SwarmCheck[] = [];
  const check = (name: string, description: string, test: () => void) => {
    try { test(); checks.push({ name, description, status: 'PASSED' }); }
    catch (error) { checks.push({ name, description, status: 'FAILED', reason: error instanceof Error ? error.message : '检查失败', suggestion: '返回区域规划调整后，在步骤3重新生成航线' }); }
  };
  check('机群与任务匹配', '服务编号唯一，每架无人机收到独立任务', () => {
    if (run.missions.length !== run.config.count || fleet.length !== run.config.count
      || new Set(run.missions.map((mission) => mission.droneId)).size !== run.config.count
      || new Set(run.missions.map((mission) => mission.missionId)).size !== run.config.count
      || run.missions.some((mission) => !fleet.some((drone) => drone.droneId === mission.droneId))) throw new Error('机群编号与任务不匹配，请重新初始化/生成');
  });
  check('完整任务路径', 'Home → 入场 → 覆盖扫描 → 服务 Home', () => {
    run.missions.forEach((mission) => {
      const drone = fleet.find((item) => item.droneId === mission.droneId);
      const path = completeMissionPath(mission, drone);
      if (!drone || !mission.entryPath?.length || !mission.returnPath?.length || !mission.waypoints.length || path.length < 3
        || path.some((point) => point.length !== 2 || point.some((value) => !Number.isFinite(value)) || toLocal(point).some((value) => Math.abs(value) > 500.001))) throw new Error('航线缺少有效入场、覆盖或返航航点');
      if (distance(toLocal(path[0]!), toLocal(drone.position)) > .05 || distance(toLocal(path.at(-1)!), toLocal(drone.homePosition)) > .05
        || distance(toLocal(mission.entryPath.at(-1)!), toLocal(mission.waypoints[mission.coverageStartIndex ?? 0]!)) > .05
        || distance(toLocal(mission.returnPath[0]!), toLocal(mission.waypoints.at(-1)!)) > .05) throw new Error('入场/返航连接与服务位置不一致');
      const length = path.slice(1).reduce((sum, point, index) => sum + distance(toLocal(path[index]!), toLocal(point)), 0);
      if (Math.abs(length - mission.plannedDistance) > .1 || !Number.isFinite(mission.estimatedDuration) || mission.estimatedDuration <= 0) throw new Error('航程或预计时间与完整路径不一致');
    });
  });
  check('蛇形扫描与分区', '按间距覆盖可飞面积，独立分区，不重复分发扫描线', () => {
    const signatures = new Set<string>();
    if (!run.area || !run.missions.length) throw new Error('未绘制区域或未生成航线');
    run.missions.forEach((mission) => {
      if (!mission.assignedPolygon || mission.assignedArea <= 0 || !Number.isFinite(mission.assignedArea) || !mission.coverageSegments.length
        || mission.coverageWaypointIndices?.length !== mission.coverageSegments.length) throw new Error('分区或覆盖航段缺失');
      mission.coverageSegments.forEach(([first, second], index) => {
        const signature = [first, second].map((point) => toLocal(point).map((value) => value.toFixed(3)).join(',')).sort().join('|');
        if (signatures.has(signature) || distance(toLocal(first), toLocal(second)) < .00001) throw new Error('扫描航段重复或无效');
        signatures.add(signature);
        const endpoint = mission.waypoints[mission.coverageWaypointIndices![index]!];
        if (!endpoint || distance(toLocal(endpoint), toLocal(second)) > .05) throw new Error('扫描终点与执行航点不一致');
      });
    });
  if (run.missions.reduce((sum, mission) => sum + mission.assignedArea, 0) > minimumCoverageRectangle(run.area, run.config.sceneOrigin).area + .1) throw new Error('分区面积超出最小外接矩形');
  });
  check('禁飞与航线几何', '扫描、衔接、直达或绕障转场均避让禁飞缓冲与安全等待点', () => {
    if (!run.area || !run.missions.length) throw new Error('请先生成航线');
    assertPlanningSafe(run.area, run.planning?.noFlyZones ?? [], run.config, run.missions, fleet);
  });
  check('安全间距', '作业带隔离，逐机入场、并行覆盖、逐机返航，等待点避让', () => {
    const positions = fleet.map((drone) => toLocal(drone.homePosition));
    if (!Number.isFinite(run.config.safety) || !Number.isFinite(run.config.spacing) || run.config.safety < 3 || run.config.spacing < run.config.safety
      || positions.some((point, index) => positions.slice(index + 1).some((other) => distance(point, other) < run.config.safety - .01))) throw new Error('初始间距或航线间距不满足安全设置');
  });
  return checks;
}
