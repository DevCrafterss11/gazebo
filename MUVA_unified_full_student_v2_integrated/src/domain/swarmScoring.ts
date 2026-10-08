import type { SwarmResult, SwarmRun } from '../types/swarm';
import { distance, toLocal } from './swarmGeometry';

export function scoreSwarm(run: SwarmRun): SwarmResult {
  if (!run.snapshot) throw new Error('实验尚无运行数据');
  const { snapshot } = run;
  const coverage = snapshot.coverage;
  const completed = snapshot.status === 'COMPLETED';
  const landed = snapshot.drones.every((drone) => drone.state === 'LANDED');
  const score = Math.round(Math.min(100, coverage * 0.7 + (completed ? 20 : 0) + (landed ? 10 : 0)));
  return { runId: run.id, completedAt: new Date().toISOString(), status: completed ? 'COMPLETED' : 'ABORTED', score, coverage, elapsed: snapshot.elapsed,
    plannedDistance: run.missions.reduce((sum, mission) => sum + mission.plannedDistance, 0), actualDistance: snapshot.drones.reduce((sum, drone) => sum + drone.trajectory.slice(1).reduce((length, point, index) => length + distance(toLocal(point), toLocal(drone.trajectory[index]!)), 0), 0),
    feedback: [completed ? '全部覆盖航段完成' : `仅完成 ${coverage.toFixed(1)}% 覆盖；未执行区域计入缺口`, landed ? '全部无人机安全降落' : '存在未降落无人机'],
    events: snapshot.events, trajectories: snapshot.drones.map((drone) => ({ droneId: drone.droneId, points: drone.trajectory })), config: run.config, area: run.area, missions: run.missions, snapshot };
}
