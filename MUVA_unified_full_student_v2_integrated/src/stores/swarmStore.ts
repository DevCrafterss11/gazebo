import { create } from 'zustand';

import { distance, homes, planMissions, toLocal, validateArea } from '../domain/swarmGeometry';
import { scoreSwarm } from '../domain/swarmScoring';
import { services } from '../services/serviceRegistry';
import type { Point, SwarmCheck, SwarmConfig, SwarmResult, SwarmRun, SwarmSnapshot } from '../types/swarm';

const key = 'muva-swarm-draft-v1';
const recordsKey = 'muva-swarm-records-v1';
const defaults: SwarmConfig = { count: 3, altitude: 30, speed: 7, spacing: 12, safety: 8, sceneId: 'campus-training', simulationMode: 'mock', worldFrame: 'ENU' };
const flightStates = ['TAKING_OFF', 'HOLDING', 'RUNNING', 'PAUSED', 'RETURNING'];
const read = (): SwarmRun | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || !parsed || !('id' in parsed) || !('config' in parsed) || !('step' in parsed)) return null;
    const run = parsed as SwarmRun;
    if (run.snapshot && flightStates.includes(run.snapshot.status) && !run.result) run.snapshot = { ...run.snapshot, interrupted: true };
    return run;
  } catch { return null; }
};
export const savedSwarmRecords = (): SwarmResult[] => { try { const parsed: unknown = JSON.parse(localStorage.getItem(recordsKey) || '[]'); return Array.isArray(parsed) ? parsed as SwarmResult[] : []; } catch { return []; } };
const persist = (run: SwarmRun | null) => { try { if (run) localStorage.setItem(key, JSON.stringify(run)); else localStorage.removeItem(key); } catch { return; } };

interface SwarmState {
  run: SwarmRun | null; error: string | null; busy: boolean;
  newRun: () => void; resume: () => void; updateConfig: (patch: Partial<SwarmConfig>) => void; initialize: () => void;
  setArea: (vertices: Point[]) => void; clearArea: () => void; plan: () => void; confirmPlan: () => void; check: () => void;
  navigate: (step: number) => void; command: (action: 'takeoff' | 'startMission' | 'pauseMission' | 'resumeMission' | 'returnToHome', droneId?: string) => void;
  finish: () => void; save: () => void; clearError: () => void; leave: () => void;
}

const makeChecks = (run: SwarmRun): SwarmCheck[] => {
  const positions = homes(run.config.count).map(toLocal);
  const separation = positions.every((point, index) => positions.slice(index + 1).every((other) => distance(point, other) >= run.config.safety));
  const tests: [string, string, boolean, string][] = [
    ['机群配置', '数量、飞行高度及速度', run.config.count >= 2 && run.config.count <= 5 && run.config.altitude >= 10 && run.config.altitude <= 120 && run.config.speed >= 1 && run.config.speed <= 20, '检查数量（2–5）、高度（10–120m）与速度（1–20m）'],
    ['唯一编号', 'SysID 与无人机编号', new Set(run.snapshot?.drones.map((drone) => drone.sysId)).size === run.config.count, '重新初始化机群'],
    ['初始位置', '起飞点位于有效坐标系', positions.length === run.config.count && positions.every((point) => point.every(Number.isFinite)), '重新初始化机群'],
    ['区域规划', '区域几何与面积有效', !!run.area, '返回区域规划并绘制合法区域'],
    ['航线完整性', '每架无人机均有覆盖航段', run.missions.length === run.config.count && run.missions.every((mission) => mission.coverageSegments.length > 0), '返回航线分配重新规划'],
    ['任务分配', '任务编号唯一且已经确认', run.confirmed && new Set(run.missions.map((mission) => mission.droneId)).size === run.config.count, '确认全部航线'],
    ['安全间距', '分时起飞、航线间距及最小起飞间距', separation && run.config.spacing >= run.config.safety, '请确保航线间距不小于最小安全间距，并核对起飞点'],
    ['运行时', 'Mock 仿真环境已初始化', !!run.snapshot && !run.snapshot.interrupted, '重新初始化机群'],
    ['任务状态', '无人机等待起飞', !!run.snapshot && run.snapshot.drones.every((drone) => drone.state === 'READY'), '重新初始化机群'],
    ['任务参数', '航线间距与安全参数', run.config.spacing >= 3 && run.config.spacing <= 50 && run.config.safety >= 3 && run.config.safety <= 13, '调整航线间距（3–50m）与安全间距（3–13m）'],
  ];
  return tests.map(([name, description, passed, suggestion]) => ({ name, description, status: passed ? 'PASSED' : 'FAILED', reason: passed ? undefined : `${name}检查未通过`, suggestion: passed ? undefined : suggestion }));
};
const runtime = services.swarm;
let unsubscribe: (() => void) | null = null;
let ending = false;
const bind = (set: (patch: Partial<SwarmState> | ((state: SwarmState) => Partial<SwarmState>)) => void) => {
  unsubscribe?.();
  unsubscribe = runtime.subscribeTelemetry((snapshot) => set((state) => {
    if (['COMPLETED', 'ABORTED'].includes(snapshot.status) && !useSwarmStore.getState().run?.result) { ending = false; queueMicrotask(() => useSwarmStore.getState().finish()); }
    if (!state.run || state.run.snapshot?.interrupted) return {};
    const run = { ...state.run, snapshot };
    persist(run);
    return { run };
  }));
};

export const useSwarmStore = create<SwarmState>((set, get) => ({
  run: read(), error: null, busy: false, clearError: () => set({ error: null }),
  newRun: () => {
    unsubscribe?.(); unsubscribe = null; runtime.dispose(); ending = false;
    const run: SwarmRun = { id: `swarm-${crypto.randomUUID()}`, createdAt: new Date().toISOString(), config: { ...defaults }, area: null, missions: [], confirmed: false, checks: [], snapshot: null, step: 1, result: null };
    persist(run); set({ run, error: null, busy: false });
  },
  resume: () => {
    const run = get().run;
    if (!run?.snapshot || run.snapshot.interrupted || run.result || flightStates.includes(run.snapshot.status)) return;
    try {
      runtime.initialize(run.config);
      if (run.missions.length) runtime.loadMission(run.missions);
      if (run.checks.length && run.checks.every((item) => item.status === 'PASSED')) runtime.markReady();
      const next = { ...run, snapshot: runtime.getStatus() };
      persist(next); set({ run: next, error: null }); bind(set);
    } catch (error) { set({ error: error instanceof Error ? error.message : '恢复机群失败' }); }
  },
  updateConfig: (patch) => { const run = get().run; if (!run || (run.snapshot && flightStates.includes(run.snapshot.status) && !run.snapshot.interrupted)) return;
    runtime.dispose(); unsubscribe?.(); unsubscribe = null;
    const next = { ...run, config: { ...run.config, ...patch }, snapshot: null, missions: [], confirmed: false, checks: [], result: null, step: 1 }; persist(next); set({ run: next, error: null });
  },
  initialize: () => { const run = get().run; if (!run) return; try {
    const { count, altitude, speed, spacing, safety } = run.config;
    if (count < 2 || count > 5 || altitude < 10 || altitude > 120 || speed < 1 || speed > 20 || spacing < 3 || spacing > 50 || safety < 3 || safety > 13) throw new Error('请核对无人机数量、飞行参数和安全间距');
    const snapshot = runtime.initialize(run.config); const next = { ...run, snapshot, missions: [], confirmed: false, checks: [], result: null }; persist(next); set({ run: next, error: null }); bind(set);
  } catch (error) { set({ error: error instanceof Error ? error.message : '机群初始化失败' }); } },
  setArea: (vertices) => { const run = get().run; if (!run?.snapshot || (flightStates.includes(run.snapshot.status) && !run.snapshot.interrupted)) return;
    try { const area = validateArea(vertices); const next = { ...run, area, missions: [], confirmed: false, checks: [] }; persist(next); set({ run: next, error: null }); }
    catch (error) { const next = { ...run, area: null, missions: [], confirmed: false, checks: [] }; persist(next); set({ run: next, error: error instanceof Error ? error.message : '区域不合法' }); } },
  clearArea: () => { const run = get().run; if (!run || (run.snapshot && flightStates.includes(run.snapshot.status) && !run.snapshot.interrupted)) return; const next = { ...run, area: null, missions: [], confirmed: false, checks: [] }; persist(next); set({ run: next, error: null }); },
  plan: () => { const run = get().run; if (!run?.area || !run.snapshot || run.snapshot.interrupted || flightStates.includes(run.snapshot.status)) { set({ error: '请先初始化机群并绘制合法区域；飞行中不可重新规划' }); return; }
    try { const missions = planMissions(run.area, run.config); runtime.loadMission(missions); const next = { ...run, missions, confirmed: false, checks: [], snapshot: runtime.getStatus() }; persist(next); set({ run: next, error: null }); }
    catch (error) { set({ error: error instanceof Error ? error.message : '无法生成有效航线' }); } },
  confirmPlan: () => { const run = get().run; if (!run || run.missions.length !== run.config.count) return; const next = { ...run, confirmed: true, checks: [], step: 4 }; persist(next); set({ run: next }); },
  check: () => { const run = get().run; if (!run) return; const checks = makeChecks(run); const passed = checks.every((item) => item.status === 'PASSED');
    if (passed) runtime.markReady();
    const snapshot = run.snapshot ? { ...run.snapshot, status: passed ? 'READY' as const : 'PLANNED' as const } : null;
    const next = { ...run, checks, snapshot }; persist(next); set({ run: next, error: passed ? null : checks.find((item) => item.status === 'FAILED')?.suggestion || '预飞检查未通过' }); },
  navigate: (step) => { const run = get().run; if (!run || step < 1 || step > 6 || (run.snapshot && flightStates.includes(run.snapshot.status) && !run.snapshot.interrupted && step !== 5) || (step >= 2 && !run.snapshot) || (step >= 3 && !run.area) || (step >= 4 && !run.confirmed) || (step === 5 && !run.result && (!run.checks.length || !run.checks.every((item) => item.status === 'PASSED'))) || (step === 6 && !run.result)) return;
    const next = { ...run, step }; persist(next); set({ run: next }); },
  command: (action, droneId) => { const run = get().run; if (!run?.snapshot || run.snapshot.interrupted) { set({ error: '模拟运行已中断，请重新初始化机群' }); return; }
    try { if (action === 'takeoff' && !run.checks.length) throw new Error('请先执行集群预飞检查');
      if (droneId) runtime.returnDroneToHome(droneId); else runtime[action](); set({ error: null }); }
    catch (error) { set({ error: error instanceof Error ? error.message : '操作失败' }); } },
  finish: () => { const run = get().run; if (!run?.snapshot) return;
    if (run.snapshot.interrupted) { const snapshot: SwarmSnapshot = { ...run.snapshot, status: 'ABORTED', events: [...run.snapshot.events, '页面刷新中断模拟运行，无法确认飞行已完成'] }; const next = { ...run, snapshot, result: scoreSwarm({ ...run, snapshot }), step: 6 }; persist(next); set({ run: next }); return; }
    if (flightStates.includes(run.snapshot.status) && !run.snapshot.drones.every((drone) => drone.state === 'LANDED')) {
      ending = true; if (run.snapshot.status !== 'RETURNING') get().command('returnToHome'); return;
    }
    runtime.stop(); const result = scoreSwarm(run); const next = { ...run, result, step: 6 }; persist(next); set({ run: next });
  },
  save: () => { const run = get().run; if (!run?.result) return;
    try { localStorage.setItem(recordsKey, JSON.stringify([run.result, ...savedSwarmRecords().filter((item) => item.runId !== run.id)])); set({ error: null }); }
    catch { set({ error: '保存失败：浏览器本地存储不可用' }); } },
  leave: () => { const run = get().run; if (run?.snapshot && flightStates.includes(run.snapshot.status) && !run.result && !run.snapshot.interrupted) { const next = { ...run, snapshot: { ...run.snapshot, interrupted: true } }; persist(next); set({ run: next }); } unsubscribe?.(); unsubscribe = null; runtime.dispose(); },
}));
