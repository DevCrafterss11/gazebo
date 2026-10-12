import { create } from 'zustand';

import { campusOrigin, distance, planMissions, swarmFrame, validateArea } from '../domain/swarmGeometry';
import { scoreSwarm } from '../domain/swarmScoring';
import { assertPlanningSafe } from '../domain/swarmPlanning';
import { acceptedMissions, checkMissionPlan, missionUploaded } from '../domain/swarmMissionWorkflow';
import { services } from '../services/serviceRegistry';
import type { Point, SwarmCheck, SwarmConfig, SwarmResult, SwarmRun, SwarmSnapshot } from '../types/swarm';

const key = 'muva-swarm-draft-v1';
const recordsKey = 'muva-swarm-records-v1';
const draftsKey = 'muva-swarm-saved-drafts-v1';
const defaults: SwarmConfig = { count: 3, altitude: 30, speed: 7, spacing: 12, safety: 8, sceneId: 'campus-training', simulationMode: services.swarm.mode, worldFrame: 'ENU', sceneOrigin: campusOrigin };
const flightStates = ['TAKING_OFF', 'HOLDING', 'RUNNING', 'PAUSED', 'RETURNING'];
const read = (): SwarmRun | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || !parsed || !('id' in parsed) || !('config' in parsed) || !('step' in parsed)) return null;
    const run = parsed as SwarmRun;
    if (run.snapshot && !run.result) delete run.snapshot.interrupted;
    return run;
  } catch { return null; }
};
export const savedSwarmRecords = (): SwarmResult[] => { try { const parsed: unknown = JSON.parse(localStorage.getItem(recordsKey) || '[]'); return Array.isArray(parsed) ? parsed as SwarmResult[] : []; } catch { return []; } };
const persist = (run: SwarmRun | null) => { try { if (run) localStorage.setItem(key, JSON.stringify(run)); else localStorage.removeItem(key); } catch { return; } };
const readDrafts = (): SwarmRun[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(draftsKey) || '[]');
    return Array.isArray(parsed) ? parsed.filter((item: unknown): item is SwarmRun => typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string' && 'config' in item && 'step' in item && 'missions' in item && Array.isArray(item.missions)) : [];
  } catch { return []; }
};
const archiveDraft = (run: SwarmRun | null, drafts: SwarmRun[]): SwarmRun[] => {
  if (!run || run.result) return drafts;
  const next = [structuredClone(run), ...drafts.filter((draft) => draft.id !== run.id)];
  localStorage.setItem(draftsKey, JSON.stringify(next));
  return next;
};

interface SwarmState {
  run: SwarmRun | null;
  savedDrafts: SwarmRun[];
  error: string | null;
  busy: boolean;
  runtimeLabel: string;
  // Service 引用，由外部 Hook 管理生命周期
  _runtimeInitialized: boolean;
  selectedDroneId: string | undefined;
  focusRevision: number;

  newRun: () => void | Promise<void>;
  restoreDraft: (runId: string) => void;
  resume: () => void;
  updateConfig: (patch: Partial<SwarmConfig>) => void;
  initialize: () => void;
  setArea: (vertices: Point[]) => void;
  clearArea: () => void;
  addNoFlyZone: (vertices: Point[]) => void;
  removeNoFlyZone: (index: number) => void;
  clearPlanning: () => void;
  setHome: (position: Point) => void;
  savePlanning: () => void;
  selectDrone: (droneId: string) => void;
  plan: () => void;
  checkPlan: () => void;
  uploadPlan: () => Promise<void>;
  confirmPlan: () => void;
  check: () => void;
  navigate: (step: number) => void;
  command: (action: 'takeoff' | 'startMission' | 'pauseMission' | 'resumeMission' | 'returnToHome', droneId?: string) => void;
  finish: () => void;
  save: () => void;
  clearError: () => void;
  leave: () => void;

  // 新增：由外部调用来更新 snapshot
  updateSnapshot: (snapshot: SwarmSnapshot) => void;
}

const makeChecks = (run: SwarmRun): SwarmCheck[] => {
  const { toLocal } = swarmFrame(run.config.sceneOrigin);
  const positions = run.snapshot?.drones.map((drone) => toLocal(drone.position)) ?? [];
  const separation = positions.every((point, index) => positions.slice(index + 1).every((other) => distance(point, other) >= run.config.safety));
  let geometrySafe = false;
  try { if (run.area && run.snapshot && run.missions.length === run.config.count) { assertPlanningSafe(run.area, run.planning?.noFlyZones ?? [], run.config, run.missions, run.snapshot.drones); geometrySafe = true; } }
  catch { geometrySafe = false; }
  const tests: [string, string, boolean, string][] = [
    ['机群配置', '数量、飞行高度及速度', run.config.count >= 2 && run.config.count <= 6 && run.config.altitude >= 10 && run.config.altitude <= 120 && run.config.speed >= 1 && run.config.speed <= 20, '检查数量（2–6）、高度（10–120m）与速度（1–20m）'],
    ['唯一编号', 'SysID 与无人机编号', new Set(run.snapshot?.drones.map((drone) => drone.sysId)).size === run.config.count, '重新初始化机群'],
    ['初始位置', '起飞点位于有效坐标系', positions.length === run.config.count && positions.every((point) => point.every(Number.isFinite)), '重新初始化机群'],
    ['区域规划', '区域几何与面积有效', !!run.area, '返回区域规划并绘制合法区域'],
    ['航线完整性', '每架无人机均有覆盖航段', run.missions.length === run.config.count && run.missions.every((mission) => mission.coverageSegments.length > 0), '返回航线分配重新规划'],
    ['航线几何安全', '最小矩形覆盖边界、扫描衔接、禁飞缓冲与安全转场', geometrySafe, '返回步骤3重新生成绕障航线'],
    ['航线下发', '当前计划每架无人机均已确认接收', missionUploaded(run), '返回步骤3检查并下发航线'],
    ['任务分配', '任务编号唯一且已经确认', run.confirmed && new Set(run.missions.map((mission) => mission.droneId)).size === run.config.count, '确认全部航线'],
    ['安全间距', '分时起飞、航线间距及最小起飞间距', separation && run.config.spacing >= run.config.safety, '请确保航线间距不小于最小安全间距，并核对起飞点'],
    ['运行时', '服务已初始化，遥测与飞控连接正常', !!run.snapshot && !run.snapshot.interrupted && run.snapshot.runtime?.connected !== false && run.snapshot.drones.every(drone => drone.connected !== false), '重新连接或初始化机群'],
    ['任务状态', '无人机等待起飞', !!run.snapshot && run.snapshot.drones.every((drone) => drone.state === 'READY'), '重新初始化机群'],
    ['任务参数', '航线间距与安全参数', run.config.spacing >= 3 && run.config.spacing <= 50 && run.config.safety >= 3 && run.config.safety <= 13, '调整航线间距（3–50m）与安全间距（3–13m）'],
  ];
  return tests.map(([name, description, passed, suggestion]) => ({ name, description, status: passed ? 'PASSED' : 'FAILED', reason: passed ? undefined : `${name}检查未通过`, suggestion: passed ? undefined : suggestion }));
};

const runtime = services.swarm;
let unsubscribe: (() => void) | null = null;
let ending = false;
const bind = () => {
  unsubscribe?.();
  unsubscribe = runtime.subscribeTelemetry((snapshot) => useSwarmStore.getState().updateSnapshot(snapshot));
};
const planningOf = (run: SwarmRun) => ({ noFlyZones: run.planning?.noFlyZones ?? [], savedAt: null });
const editableRun = (run: SwarmRun | null): run is SwarmRun => !!run && !run.result && !run.snapshot?.drones.some(drone => drone.armed) && (!run.snapshot || !flightStates.includes(run.snapshot.status) || !!run.snapshot.interrupted);
const validConfig = (config: SwarmConfig) => {
  const { count, altitude, speed, spacing, safety } = config;
  return [count, altitude, speed, spacing, safety].every(Number.isFinite) && Number.isInteger(count)
    && count >= 2 && count <= 6 && altitude >= 10 && altitude <= 120 && speed >= 1 && speed <= 20
    && spacing >= 3 && spacing <= 50 && safety >= 3 && safety <= 13 && spacing >= safety;
};
const invalidatedMission = (run: SwarmRun) => {
  if (run.snapshot) runtime.loadMission([]);
  return { missions: [], confirmed: false, checks: [], delivery: undefined,
    snapshot: run.snapshot ? { ...run.snapshot, status: 'DRAFT' as const, missionReceipts: [] } : null };
};

export const useSwarmStore = create<SwarmState>((set, get) => ({
  run: read(), savedDrafts: readDrafts(), error: null, busy: false, runtimeLabel: runtime.label, _runtimeInitialized: false, selectedDroneId: undefined, focusRevision: 0,
  clearError: () => set({ error: null }),
  selectDrone: (droneId) => set((state) => ({ selectedDroneId: droneId, focusRevision: state.focusRevision + 1 })),
  updateSnapshot: (snapshot) => {
    const run = get().run;
    if (!run || run.snapshot?.interrupted) return;
    const next = { ...run, snapshot };
    persist(next); set({ run: next, error: snapshot.runtime?.error ?? get().error });
    if (['COMPLETED', 'ABORTED'].includes(snapshot.status) && !run.result) {
      ending = false;
      queueMicrotask(() => get().finish());
    }
  },
  newRun: () => {
    if (get().busy) return;
    const previous = get().run;
    if (runtime.mode === 'mock' && previous?.snapshot?.drones.some(drone => drone.armed)) { set({ error: '机群仍在运行，请先返航并确认全部降落后重新开始' }); return; }
    const run: SwarmRun = { id: `swarm-${crypto.randomUUID()}`, createdAt: new Date().toISOString(), config: { ...defaults }, area: null, missions: [], confirmed: false, checks: [], snapshot: null, step: 1, result: null, planning: { noFlyZones: [], savedAt: null } };
    const commit = () => {
      let savedDrafts: SwarmRun[];
      try {
        savedDrafts = archiveDraft(get().run, get().savedDrafts);
        localStorage.setItem(key, JSON.stringify(run));
      } catch { set({ error: '本地存储不可用，无法安全保留原进度；未开始新实验', busy: false }); return; }
      unsubscribe?.(); unsubscribe = null; runtime.dispose(); ending = false;
      set({ run, savedDrafts, error: null, busy: false, _runtimeInitialized: false, selectedDroneId: undefined });
    };
    const sessionId = runtime.mode === 'sitl' ? previous?.snapshot?.runtime?.sessionId : null;
    if (!sessionId) { commit(); return; }
    set({ busy: true, error: null });
    return Promise.resolve(runtime.shutdown(sessionId)).then(() => {
      if (get().run?.id === previous?.id) commit();
    }).catch((error: unknown) => {
      set({ busy: false, error: `无法安全关闭旧机群，已保留当前实验；请确认全部飞控在线、上锁并落地后重试：${error instanceof Error ? error.message : '关闭失败'}` });
    });
  },
  restoreDraft: (runId) => {
    const draft = get().savedDrafts.find((item) => item.id === runId);
    if (!draft) { set({ error: '未找到这份保留进度' }); return; }
    const run = structuredClone(draft);
    let savedDrafts: SwarmRun[];
    try {
      savedDrafts = archiveDraft(get().run, get().savedDrafts);
      localStorage.setItem(key, JSON.stringify(run));
    } catch { set({ error: '本地存储不可用，未切换进度；当前实验仍保留' }); return; }
    unsubscribe?.(); unsubscribe = null; runtime.dispose(); ending = false;
    set({ run, savedDrafts, error: null, busy: false, _runtimeInitialized: false, selectedDroneId: undefined });
  },
  resume: async () => {
    const run = get().run;
    if (!run?.snapshot || run.result) return;
    try {
      unsubscribe?.(); unsubscribe = null;
      const delivery = run.delivery?.status === 'UPLOADING' ? { ...run.delivery, status: 'CHECKED' as const, receipts: [], uploadedAt: null } : run.delivery;
      const snapshot = run.delivery?.status === 'UPLOADING' ? { ...run.snapshot, missionReceipts: [] } : run.snapshot;
      set({ busy: true });
      const pending = runtime.restore(run.config, run.missions, snapshot);
      const restored = pending instanceof Promise ? await pending : pending;
      if (get().run?.id !== run.id) return;
      const accepted = !!delivery && (restored.missionPlanId === delivery.planId
        || (!restored.missionPlanId && restored.status === 'PLANNED' && ['GENERATED', 'CHECKED'].includes(delivery.status)));
      const next = { ...run, delivery: accepted ? delivery : undefined, confirmed: accepted && run.confirmed,
        checks: accepted ? run.checks : [], step: accepted ? run.step : Math.min(run.step, 3), snapshot: restored };
      persist(next); set({ run: next, error: null, busy: false, _runtimeInitialized: true }); bind();
    } catch (error) { set({ busy: false, error: error instanceof Error ? error.message : '恢复机群失败' }); }
  },
  updateConfig: (patch) => { const run = get().run; if (!run || get().busy || (run.snapshot && (flightStates.includes(run.snapshot.status) || run.snapshot.drones.some(drone => drone.armed)) && !run.snapshot.interrupted)) return;
    runtime.dispose(); unsubscribe?.(); unsubscribe = null;
    const next = { ...run, config: { ...run.config, ...patch }, snapshot: null, missions: [], confirmed: false, checks: [], delivery: undefined, result: null, step: run.step === 2 ? 2 : 1, planning: planningOf(run) }; persist(next); set({ run: next, error: null, busy: false, _runtimeInitialized: false, selectedDroneId: undefined });
  },
  initialize: async () => { const run = get().run; if (!run || get().busy) return; try {
    if (!editableRun(run)) return;
    if (!validConfig(run.config)) throw new Error('请核对无人机数量、飞行参数和安全间距；航线间距不能小于安全间距');
    unsubscribe?.(); unsubscribe = null;
    set({ busy: true, error: null });
    const pending = runtime.initialize(run.config);
    const snapshot = pending instanceof Promise ? await pending : pending;
    if (get().run?.id !== run.id) return;
    const next = { ...run, config: { ...run.config, simulationMode: runtime.mode }, snapshot, missions: [], confirmed: false, checks: [], delivery: undefined, result: null, planning: planningOf(run) }; persist(next); set({ run: next, error: null, busy: false, _runtimeInitialized: true }); bind();
  } catch (error) { set({ busy: false, error: error instanceof Error ? error.message : '机群初始化失败' }); } },
  setArea: (vertices) => { const run = get().run; if (!editableRun(run)) return;
    try { const area = validateArea(vertices, run.config.sceneOrigin); const next = { ...run, ...invalidatedMission(run), area, planning: planningOf(run) }; persist(next); set({ run: next, error: null, busy: false }); }
    catch (error) { set({ error: error instanceof Error ? error.message : '区域不合法' }); } },
  clearArea: () => { const run = get().run; if (!editableRun(run)) return; const next = { ...run, ...invalidatedMission(run), area: null, planning: planningOf(run) }; persist(next); set({ run: next, error: null, busy: false }); },
  addNoFlyZone: (vertices) => {
    const run = get().run; if (!editableRun(run)) return;
    try {
      const zone = validateArea(vertices, run.config.sceneOrigin);
      const next = { ...run, ...invalidatedMission(run), planning: { noFlyZones: [...(run.planning?.noFlyZones ?? []), zone], savedAt: null } };
      persist(next); set({ run: next, error: null, busy: false });
    } catch (error) { set({ error: error instanceof Error ? error.message : '禁飞区无效' }); }
  },
  removeNoFlyZone: (index) => {
    const run = get().run; if (!editableRun(run)) return;
    const next = { ...run, ...invalidatedMission(run), planning: { noFlyZones: (run.planning?.noFlyZones ?? []).filter((_, position) => position !== index), savedAt: null } };
    persist(next); set({ run: next, error: null, busy: false });
  },
  clearPlanning: () => {
    const run = get().run; if (!editableRun(run)) return;
    unsubscribe?.(); unsubscribe = null; runtime.dispose();
    const next = { ...run, config: { ...run.config, homePosition: undefined }, area: null, missions: [], confirmed: false, checks: [], delivery: undefined, snapshot: null, planning: { noFlyZones: [], savedAt: null } };
    persist(next); set({ run: next, error: null, busy: false, _runtimeInitialized: false, selectedDroneId: undefined });
  },
  setHome: (position) => {
    const run = get().run; if (!editableRun(run)) return;
    const { toLocal } = swarmFrame(run.config.sceneOrigin);
    if (!position.every(Number.isFinite) || toLocal(position).some((value) => Math.abs(value) > 500)) {
      set({ error: '规划 Home 必须位于校园训练范围（中心 500 m）内' }); return;
    }
    const next = { ...run, ...invalidatedMission(run), config: { ...run.config, homePosition: position }, planning: planningOf(run) };
    persist(next); set({ run: next, error: null, busy: false });
  },
  savePlanning: () => {
    const run = get().run; if (!editableRun(run)) return;
    try {
      const next = { ...run, planning: { ...planningOf(run), savedAt: new Date().toISOString() } };
      localStorage.setItem(key, JSON.stringify(next)); set({ run: next, error: null });
    } catch { set({ error: '规划保存失败：浏览器本地存储不可用' }); }
  },
  plan: () => { const run = get().run; if (run?.step !== 3 || !run.area || !run.snapshot || run.snapshot.interrupted || flightStates.includes(run.snapshot.status)) { set({ error: '请在步骤3「航线分配」生成航线；先初始化机群并绘制合法区域，飞行中不可重新规划' }); return; }
    if (run.config.sceneOrigin && !run.config.homePosition) { set({ error: '请先在地图中设置起降点 Home，再生成覆盖航线' }); return; }
    try {
      if (!validConfig(run.config)) throw new Error('飞行参数无效，请检查任务配置');
      const planId = crypto.randomUUID();
      const planningConfig = { ...run.config, safety: run.config.safety + (runtime.mode === 'sitl' ? 2 : 0) };
      const missions = planMissions(run.area, planningConfig, run.snapshot.drones, run.planning?.noFlyZones ?? []).map((mission, index) => ({ ...mission, missionId: `${planId}-${index + 1}` }));
      assertPlanningSafe(run.area, run.planning?.noFlyZones ?? [], run.config, missions, run.snapshot.drones);
      runtime.loadMission(missions);
      const next: SwarmRun = { ...run, missions, confirmed: false, checks: [], snapshot: runtime.getStatus(), planning: planningOf(run),
        delivery: { planId, status: 'GENERATED', checks: [], receipts: [], checkedAt: null, uploadedAt: null } };
      persist(next); set({ run: next, error: null, busy: false });
    }
    catch (error) { set({ error: error instanceof Error ? error.message : '无法生成有效航线' }); } },
  checkPlan: () => {
    const run = get().run;
    if (run?.step !== 3 || !editableRun(run) || !run.delivery || !run.missions.length || get().busy) { set({ error: '请在步骤3先生成航线，再执行航线检查' }); return; }
    const checks = checkMissionPlan(run);
    const passed = checks.every((item) => item.status === 'PASSED');
    const next: SwarmRun = { ...run, confirmed: false, checks: [], delivery: { ...run.delivery, checks,
      status: passed ? missionUploaded(run) ? 'UPLOADED' : 'CHECKED' : 'GENERATED', checkedAt: passed ? new Date().toISOString() : null } };
    if (!passed) { runtime.loadMission(run.missions); next.snapshot = runtime.getStatus(); next.delivery = { ...next.delivery!, receipts: [], uploadedAt: null }; }
    persist(next); set({ run: next, error: passed ? null : checks.find((item) => item.status === 'FAILED')?.reason ?? '航线检查未通过' });
  },
  uploadPlan: async () => {
    const run = get().run;
    if (run?.step !== 3 || !editableRun(run) || !run.delivery || !['CHECKED', 'UPLOADED'].includes(run.delivery.status) || get().busy) { set({ error: '请先检查航线，通过后才能下发' }); return; }
    const checks = checkMissionPlan(run);
    if (checks.some((item) => item.status !== 'PASSED')) { get().checkPlan(); return; }
    if (missionUploaded(run)) return;
    const planId = run.delivery.planId;
    const pending: SwarmRun = { ...run, delivery: { ...run.delivery, status: 'UPLOADING', checks, receipts: [], uploadedAt: null } };
    persist(pending); set({ run: pending, busy: true, error: null });
    try {
      const receipts = await runtime.uploadMission(run.missions, planId);
      const current = get().run;
      if (!current || current.id !== run.id || current.delivery?.planId !== planId || current.delivery.status !== 'UPLOADING') return;
      if (!acceptedMissions(current.missions, receipts, current.snapshot?.drones ?? [], planId)) throw new Error('未收到当前计划的全部有效回执，请重新下发');
      const next: SwarmRun = { ...current, snapshot: runtime.getStatus(), delivery: { ...current.delivery, status: 'UPLOADED', receipts, uploadedAt: new Date().toISOString() } };
      persist(next); set({ run: next, busy: false, error: null });
    } catch (error) {
      const current = get().run;
      if (!current || current.id !== run.id || current.delivery?.planId !== planId || current.delivery.status !== 'UPLOADING') return;
      const next: SwarmRun = { ...current, delivery: { ...current.delivery, status: 'CHECKED', receipts: [], uploadedAt: null } };
      persist(next); set({ run: next, busy: false, error: error instanceof Error ? error.message : '航线下发失败，请重试' });
    }
  },
  confirmPlan: () => {
    const run = get().run;
    if (!run || !missionUploaded(run)) { set({ error: '请先完成航线检查和下发，全部无人机确认接收后进入预检查' }); return; }
    const next = { ...run, confirmed: true, checks: [], step: 4 }; persist(next); set({ run: next, error: null });
  },
  check: async () => { const run = get().run; if (!editableRun(run) || get().busy) return;
    try {
      const checks = makeChecks(run); const passed = checks.every((item) => item.status === 'PASSED');
      if (passed) { set({ busy: true }); const pending = runtime.markReady(); if (pending instanceof Promise) await pending; }
      const snapshot = run.snapshot ? { ...run.snapshot, status: passed ? 'READY' as const : 'PLANNED' as const } : null;
      const next: SwarmRun = { ...run, checks, snapshot, delivery: run.delivery ? { ...run.delivery, status: passed ? 'WAITING_TAKEOFF' : missionUploaded(run) ? 'UPLOADED' : run.delivery.status } : undefined };
      persist(next); set({ run: next, busy: false, error: passed ? null : checks.find((item) => item.status === 'FAILED')?.suggestion || '预飞检查未通过' });
    } catch (error) { set({ busy: false, error: error instanceof Error ? error.message : '预飞检查失败' }); }
  },
  navigate: (step) => { const run = get().run; if (!run || step < 1 || step > 6 || (run.snapshot && flightStates.includes(run.snapshot.status) && !run.snapshot.interrupted && step !== 5) || (step >= 3 && (!run.snapshot || !run.area)) || (step >= 4 && !run.result && (!run.confirmed || !missionUploaded(run))) || (step === 5 && !run.result && (!run.checks.length || !run.checks.every((item) => item.status === 'PASSED'))) || (step === 6 && !run.result)) return;
    const next = { ...run, step }; persist(next); set({ run: next }); },
  command: async (action, droneId) => { const run = get().run; if (!run?.snapshot || run.snapshot.interrupted) { set({ error: '模拟运行已中断，请重新初始化机群' }); return; }
    try { if (action === 'takeoff' && (!missionUploaded(run) || run.delivery?.status !== 'WAITING_TAKEOFF' || !run.checks.length || run.checks.some((item) => item.status !== 'PASSED'))) throw new Error('请先检查并下发航线，全部无人机接收成功且预飞检查通过后才能起飞');
      const pending = droneId ? runtime.returnDroneToHome(droneId) : runtime[action]();
      if (pending instanceof Promise) { set({ busy: true }); await pending; }
      set({ error: null, busy: false }); }
    catch (error) { set({ busy: false, error: error instanceof Error ? error.message : '操作失败' }); } },
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
  leave: () => {
    runtime.stop(); const run = get().run;
    const next: SwarmRun | null = run?.delivery?.status === 'UPLOADING' ? { ...run, snapshot: run.snapshot ? { ...run.snapshot, missionReceipts: [] } : null,
      delivery: { ...run.delivery, status: 'CHECKED', receipts: [], uploadedAt: null } } : run;
    if (next) persist(next); unsubscribe?.(); unsubscribe = null; runtime.dispose(); set({ run: next, busy: false, _runtimeInitialized: false });
  },
}));
