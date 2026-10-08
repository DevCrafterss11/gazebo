import { create } from 'zustand';
import { services } from '../services/serviceRegistry';
import { TrainingRuleEngine } from '../domain/assessment/TrainingRuleEngine';
import { scoreRun } from '../domain/assessment/ScoringEngine';
import { createRun, diagnosticQuestions, experimentId, parts, questions, scenes, tasks, type AssessmentConfig, type Evidence, type ExperimentRun, type Fault, type SimulationSnapshot } from '../domain/assessment/model';
import type { TelemetrySample } from '../types/telemetry';
import { isRealTelemetryReady } from '../services/assessment/coordinates';

const realMode = services.assessmentAdapter.source === 'real';
const activeKey = realMode ? 'muva-assessment-real-active-v1' : 'muva-assessment-active-v1';
const recordsKey = realMode ? 'muva-assessment-real-records-v1' : 'muva-assessment-records-v1';
const assessmentRuntime = services.assessment;
const initial = assessmentRuntime.snapshot();
const restore = (): ExperimentRun => {
  try {
    const value = JSON.parse(localStorage.getItem(activeKey) ?? 'null') as ExperimentRun | null;
    if (value?.experimentId === experimentId && Array.isArray(value.taskResults)) return {
      ...createRun(), ...value, environment: 'STOPPED', safetyPassed: false, preflightConfirmed: false,
      status: value.status === 'COMPLETED' || value.status === 'ABORTED' ? value.status : 'PAUSED',
      taskResults: value.taskResults.map((task) => task.status === 'RUNNING' ? { ...task, status: 'INTERRUPTED', reason: '刷新后模拟已停止' } : task),
    };
  } catch { return createRun(); }
  return createRun();
};
const evidence = (run: ExperimentRun, type: Evidence['type'], message: string, sample?: TelemetrySample): ExperimentRun => ({ ...run, evidence: [...run.evidence, { id: crypto.randomUUID(), runId: run.runId, timestamp: Date.now(), type, message, sample }].slice(-1000) });
const commit = (run: ExperimentRun, set: (change: Partial<State>) => void) => {
  const scored = { ...run, scoreBreakdown: scoreRun(run) };
  try { localStorage.setItem(activeKey, JSON.stringify(scored)); } catch { /* Current session remains in memory. */ }
  set({ run: scored, error: '' });
};
export const validConfig = (config: AssessmentConfig) => Number.isFinite(config.altitude) && config.altitude >= 2 && config.altitude <= 30 && Number.isFinite(config.speed) && config.speed > 0 && config.speed <= 5 && Number.isFinite(config.hoverSeconds) && config.hoverSeconds >= 3 && config.hoverSeconds <= 60;
const fresh = (sample: TelemetrySample | null) => !!sample && sample.timestamp > 0 && Date.now() - sample.timestamp < 3000 && sample.mavlinkStatus.connected;
export const diagnosis = (run: ExperimentRun, sample: TelemetrySample | null) => [
  { name: 'GPS', status: !fresh(sample) ? 'UNKNOWN / STALE' : sample!.gpsSatellites >= 6 ? 'PASS' : 'FAIL', source: '模拟卫星数', impact: '航点和定位' },
  { name: 'IMU', status: !fresh(sample) ? 'UNKNOWN / STALE' : 'PASS', source: '模拟惯导', impact: '姿态控制' },
  { name: 'EKF', status: !fresh(sample) ? 'UNKNOWN / STALE' : sample!.ekfStatus.healthy ? 'PASS' : 'FAIL', source: '模拟估计器', impact: '位置融合' },
  { name: '电池', status: !fresh(sample) ? 'UNKNOWN / STALE' : sample!.batteryPercent >= 20 ? 'PASS' : 'FAIL', source: '模拟电量', impact: '返航余量' },
  { name: '心跳 / 通信', status: !fresh(sample) ? 'UNKNOWN / STALE' : 'PASS', source: '模拟通信链路', impact: '命令控制' },
  { name: '飞行模式', status: !fresh(sample) ? 'UNKNOWN / STALE' : sample!.mode === 'GUIDED' ? 'PASS' : 'FAIL', source: '模拟模式', impact: '位置任务' },
  { name: '位置与姿态', status: !fresh(sample) ? 'UNKNOWN / STALE' : Number.isFinite(sample!.position.latitude) ? 'PASS' : 'FAIL', source: '模拟遥测', impact: '导航' },
  { name: '当前故障', status: run.fault === 'normal' ? 'PASS' : 'FAIL', source: '教学情境', impact: run.fault },
];
export const safetyChecks = (run: ExperimentRun, sample: TelemetrySample | null) => [
  ['模拟环境 READY', run.environment === 'READY'], ['遥测新鲜', fresh(sample)],
  ['飞行模式 GUIDED', fresh(sample) && sample?.mode === 'GUIDED'], ['Home 已确认', run.sceneConfirmed],
  ['GPS', fresh(sample) && (sample?.gpsSatellites ?? 0) >= 6 && run.fault !== 'gps'], ['EKF', fresh(sample) && sample?.ekfStatus.healthy === true && run.fault !== 'ekf'],
  ['电池 ≥ 20%', fresh(sample) && (sample?.batteryPercent ?? 0) >= 20], ['通信心跳', fresh(sample) && sample?.mavlinkStatus.heartbeat === true],
  ['尚未解锁', sample?.armed === false], ['训练参数有效', validConfig(run.configuration)],
] as [string, boolean][];

let unsubscribe: (() => void) | null = null;
let engine: TrainingRuleEngine | null = null;
let lastTrace = 0;
let lastSaved = 0;
let lastEvaluated = 0;
let unsubscribeObserver: (() => void) | null = null;
interface State {
  run: ExperimentRun; flight: SimulationSnapshot; sample: TelemetrySample | null; error: string; startupBusy: boolean;
  source: 'mock' | 'real'; observing: boolean; observerError: string; observedSample: TelemetrySample | null; observedFlight: SimulationSnapshot | null;
  connectObserver: () => Promise<void>; disconnectObserver: () => void;
  hydrate: () => void; newRun: () => void; restartTraining: () => void; learn: (part: string) => void; answerQuiz: (id: string, answer: string) => void; submitQuiz: () => void;
  configure: (config: AssessmentConfig, answer: string) => void; chooseScene: (id: string) => void; confirmScene: () => void;
  setStartupFailure: (failure?: ExperimentRun['simulationFailure']) => void; start: () => Promise<void>; stop: () => Promise<void>;
  setFault: (fault: Fault) => void; answerDiagnosis: (id: string, answer: string) => void; submitDiagnosis: () => void;
  checkSafety: () => void; confirmSafety: () => void; armSafety: () => void; setGuided: () => void; startTask: () => void; control: (action: string, value?: number | { x: number; z: number }) => void;
  answerAnomaly: (answer: string) => void; selectAnomaly: (answer: string) => void; submitAnomaly: () => void; submitReview: (taskId: string, text: string) => void; save: () => void; abort: () => void;
  advance: () => void; goTo: (step: number) => void;
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const useAssessmentStore = create<State>((set, get) => ({
  run: restore(), flight: initial, sample: null, error: '', startupBusy: false,
  source: services.assessmentAdapter.source, observing: false, observerError: '', observedSample: null, observedFlight: null,
  connectObserver: async () => {
    if (!realMode || get().observing || unsubscribeObserver) return;
    try {
      const adapter = services.assessmentAdapter;
      unsubscribeObserver = adapter.subscribe((sample, flight) => {
        set({ observedSample: sample, observedFlight: flight, observerError: isRealTelemetryReady(sample) && flight ? '' : '飞控遥测未知 / 过期，禁止操作' });
      });
      try { await adapter.connect(); set({ observing: true, observerError: '等待真实遥测快照（仅供观测）' }); }
      catch (error) { unsubscribeObserver?.(); unsubscribeObserver = null; adapter.disconnect(); throw error; }
    } catch (error) { set({ observerError: error instanceof Error ? error.message : '网关连接失败', observing: false }); }
  },
  disconnectObserver: () => { unsubscribeObserver?.(); unsubscribeObserver = null; services.assessmentAdapter.disconnect(); set({ observing: false, observedSample: null, observedFlight: null, observerError: '已断开只读观测' }); },
  hydrate: () => {
    if (realMode) return;
    if (unsubscribe) return;
    unsubscribe = assessmentRuntime.subscribe((flight) => {
      set({ flight });
      const run = get().run;
      if (run.environment !== 'READY') return;
      const sample = assessmentRuntime.telemetry();
      set({ sample });
      if (Date.now() - lastEvaluated < 100) return;
      lastEvaluated = Date.now();
      const active = run.taskResults.find((item) => item.status === 'RUNNING');
      const result = active && engine && fresh(sample) ? engine.evaluate(active, sample) : active;
      const track = run.telemetrySummary.track;
      let next: ExperimentRun = { ...run };
      if (Date.now() - lastTrace >= 500 && sample.timestamp > 0) {
        lastTrace = Date.now();
        next = { ...next, trajectory: [...next.trajectory, { timestamp: sample.timestamp, ...flight.position, ...flight.attitude, ...flight.velocity, taskId: active?.taskId }].slice(-2500), telemetrySummary: { samples: run.telemetrySummary.samples + 1, maxAltitude: Math.max(run.telemetrySummary.maxAltitude, flight.position.y), maxSpeed: Math.max(run.telemetrySummary.maxSpeed, sample.speedMetersPerSecond), track: [...track, { north: -flight.position.z, east: flight.position.x, altitude: flight.position.y, timestamp: sample.timestamp }].slice(-2500) } };
      }
      if (active && result && result !== active) {
        next.taskResults = run.taskResults.map((item) => item.taskId === active.taskId ? result : item);
        if (result.status === 'PASSED') {
          const following = next.taskResults[tasks.findIndex((task) => task.taskId === active.taskId) + 1];
          if (following) next.taskResults = next.taskResults.map((item) => item.taskId === following.taskId ? { ...item, status: 'READY' } : item);
          const points = Math.max(0, (taskPoints[active.taskId] ?? 0) - (active.taskId === 'hover' && next.hoverBreaks > 0 ? 1 : 0));
          next.taskScores = { ...run.taskScores, [active.taskId]: points };
          next = evidence(next, 'TASK', `${active.taskId} 遥测达标`, sample);
        } else if (active.taskId === 'hover' && active.metrics && active.metrics.positionError <= 1.5 && result.metrics?.positionError && result.metrics.positionError > 1.5) next.hoverBreaks++;
      }
      if (next !== run) {
        set({ run: next });
        if (Date.now() - lastSaved > 3000 || result?.status === 'PASSED') { lastSaved = Date.now(); commit(next, set); }
      }
    });
  },
  newRun: () => { if (get().flight.airborne || get().flight.armed) return set({ error: '请先安全降落' }); assessmentRuntime.stop(); engine = null; commit(createRun(), set); set({ flight: assessmentRuntime.snapshot(), sample: null }); },
  restartTraining: () => {
    const run = get().run;
    if (run.status === 'COMPLETED' || get().flight.armed || get().flight.airborne) return set({ error: '请先降落；已结算成绩请新建 Run' });
    assessmentRuntime.stop(); engine = null; const reset = createRun();
    commit(evidence({ ...run, step: 3, status: 'PAUSED', environment: 'STOPPED', safetyPassed: false, preflightConfirmed: false, taskResults: reset.taskResults, taskScores: {}, trajectory: [], telemetrySummary: reset.telemetrySummary, hoverBreaks: 0, completedSteps: run.completedSteps.filter((step) => step < 3), anomalySubmitted: false }, 'SAFETY', '重置训练后需重新模拟启动及安全检查'), set);
    set({ sample: null });
  },
  learn: (id) => { const run = get().run; if (!parts.some((part) => part.id === id) || run.status === 'COMPLETED') return; commit({ ...run, learnedParts: [...new Set([...run.learnedParts, id])] }, set); },
  answerQuiz: (id, answer) => { const run = get().run; if (run.status === 'COMPLETED' || run.quizSubmitted && run.configuration.trainingMode === 'exam') return; commit({ ...run, quizAnswers: { ...run.quizAnswers, [id]: answer }, quizSubmitted: false }, set); },
  submitQuiz: () => { const run = get().run; if (run.learnedParts.length < parts.length || !questions.every((question) => run.quizAnswers[question.id])) return set({ error: '请学习八个部件并完成全部测验' }); commit(evidence({ ...run, quizSubmitted: true }, 'ACTION', '知识测验已提交'), set); },
  configure: (configuration, answer) => { const run = get().run; if (run.environment !== 'STOPPED' || run.status === 'COMPLETED') return set({ error: '请先停止模拟环境' }); if (!validConfig(configuration) || !answer) return set({ error: '高度 2–30m、速度 0–5m/s、悬停 3–60s，并完成参数理解题' }); const reset = createRun(); engine = null; commit(evidence({ ...run, step: 1, status: 'CONFIGURING', configuration, configurationConfirmed: true, parameterAnswer: answer, completedSteps: run.completedSteps.filter((step) => step < 1), scene: null, sceneConfirmed: false, taskResults: reset.taskResults, taskScores: {}, trajectory: [], telemetrySummary: reset.telemetrySummary, safetyPassed: false, preflightConfirmed: false }, 'ACTION', '参数已确认，后续任务重新生成'), set); },
  chooseScene: (id) => { const run = get().run; if (run.environment !== 'STOPPED' || !scenes.some((scene) => scene.id === id && scene.available)) return set({ error: '需停止环境并选择已开放场景' }); const reset = createRun(); engine = null; commit({ ...run, scene: id, sceneConfirmed: false, safetyPassed: false, preflightConfirmed: false, taskResults: reset.taskResults, taskScores: {}, trajectory: [], telemetrySummary: reset.telemetrySummary, completedSteps: run.completedSteps.filter((step) => step < 2) }, set); },
  confirmScene: () => { const run = get().run; if (realMode) return set({ error: '真实模式无法验证当前 Gazebo World；仅支持只读遥测，不确认前端模拟场景为真实场景' }); if (!scenes.some((scene) => scene.id === run.scene && scene.available)) return set({ error: '请选择已开放场景' }); commit(evidence({ ...run, sceneConfirmed: true }, 'ACTION', `确认前端模拟场景 ${run.scene}`), set); },
  setStartupFailure: (simulationFailure) => commit({ ...get().run, simulationFailure }, set),
  start: async () => {
    if (realMode) return set({ error: '真实模式禁止启动共享 SITL：网关缺少跨实验会话原子资源所有权' });
    const run = get().run; if (get().startupBusy || !run.sceneConfirmed || run.environment === 'READY') return set({ error: '请先确认场景或等待当前启动完成' });
    set({ startupBusy: true }); commit({ ...run, environment: 'STARTING', status: 'ENVIRONMENT_STARTING', simulationLog: [] }, set);
    const phases = ['加载前端场景资源', '初始化 Mock 飞控', '建立模拟数据通信', '启动遥测生成器', '校验初始状态'];
    for (let index = 0; index < phases.length; index++) {
      await sleep(400);
      if (get().run.environment !== 'STARTING') { set({ startupBusy: false }); return; }
      if ((run.simulationFailure === 'scene' && index === 0) || (run.simulationFailure === 'link' && index === 2) || (run.simulationFailure === 'telemetry' && index === 3)) {
        commit({ ...get().run, environment: 'FAILED', status: 'FAILED', environmentError: `${phases[index]}失败`, simulationLog: [...get().run.simulationLog, `失败：${phases[index]}`] }, set);
        set({ startupBusy: false }); return;
      }
      commit({ ...get().run, simulationLog: [...get().run.simulationLog, `${index + 1}/5 ${phases[index]}完成`] }, set);
    }
    assessmentRuntime.start(run.configuration, run.scene ?? 'runway');
    commit(evidence({ ...get().run, environment: 'READY', status: 'READY', fault: 'normal', environmentError: undefined }, 'ACTION', 'Mock 环境 READY'), set);
    set({ startupBusy: false, sample: assessmentRuntime.telemetry() });
  },
  stop: async () => { if (realMode) return set({ error: '只读模式不允许停止其他实验的共享仿真' }); const run = get().run; if (get().flight.armed || get().flight.airborne) return set({ error: '模拟无人机未着陆，无法停止' }); commit({ ...run, environment: 'STOPPING' }, set); await sleep(250); assessmentRuntime.stop(); commit(evidence({ ...get().run, environment: 'STOPPED', status: 'PAUSED', safetyPassed: false, preflightConfirmed: false }, 'ACTION', '模拟环境已停止'), set); set({ sample: null }); },
  setFault: (fault) => {
    const run = get().run;
    if (run.status === 'COMPLETED') return;
    assessmentRuntime.setFault(fault);
    if (fault !== 'normal') engine?.interruptStability();
    commit(evidence({ ...run, fault, safetyPassed: false, preflightConfirmed: false, taskResults: fault !== 'normal' ? run.taskResults.map((item) => item.status === 'RUNNING' ? { ...item, status: 'INTERRUPTED', reason: `模拟 ${fault} 异常，任务中断` } : item) : run.taskResults }, 'DIAGNOSTIC', `切换教学情境：${fault}`), set);
    set({ sample: assessmentRuntime.telemetry() });
  },
  answerDiagnosis: (id, answer) => { const run = get().run; if (run.configuration.trainingMode === 'exam' && run.diagnosticSubmitted) return; commit({ ...run, diagnosticAnswers: { ...run.diagnosticAnswers, [id]: answer }, diagnosticSubmitted: false }, set); },
  submitDiagnosis: () => { const run = get().run; if (!diagnosticQuestions.every((question) => run.diagnosticAnswers[question.id])) return set({ error: '请完成诊断问答' }); commit(evidence({ ...run, diagnosticSubmitted: true }, 'DIAGNOSTIC', `已提交诊断，情境 ${run.fault}`), set); },
  checkSafety: () => { const run = get().run; const failures = safetyChecks(run, get().sample).filter(([, pass]) => !pass); commit(evidence({ ...run, safetyPassed: failures.length === 0, preflightConfirmed: false }, 'SAFETY', failures.length ? `安全检查失败：${failures.map(([name]) => name).join('、')}` : '安全检查通过（未解锁）'), set); if (failures.length) set({ error: `未通过：${failures.map(([name]) => name).join('、')}` }); },
  confirmSafety: () => { const run = get().run; if (!run.safetyPassed || safetyChecks(run, get().sample).some(([, pass]) => !pass)) return set({ error: '需重新通过全部检查' }); commit(evidence({ ...run, preflightConfirmed: true }, 'SAFETY', '确认起飞安全决策'), set); },
  armSafety: () => { const run = get().run; if (!run.preflightConfirmed || run.environment !== 'READY' || run.fault !== 'normal' || safetyChecks(run, get().sample).filter(([name]) => name !== '尚未解锁').some(([, passed]) => !passed)) return set({ error: '请先通过并确认安全检查' }); try { assessmentRuntime.command('arm'); commit(evidence(run, 'COMMAND', '模拟 ARM 已完成，飞行器尚未起飞'), set); } catch (error) { set({ error: error instanceof Error ? error.message : '解锁失败' }); } },
  setGuided: () => { try { assessmentRuntime.command('guided'); commit(evidence({ ...get().run, safetyPassed: false, preflightConfirmed: false }, 'COMMAND', '模拟飞行模式切换为 GUIDED'), set); } catch (error) { set({ error: error instanceof Error ? error.message : '切换失败' }); } },
  startTask: () => { const run = get().run; const index = run.taskResults.findIndex((item) => item.status === 'READY' || item.status === 'INTERRUPTED' && run.configuration.trainingMode !== 'exam'); if (index < 0 || run.status === 'COMPLETED' || run.status === 'ABORTED' || run.taskResults.some((item) => item.status === 'RUNNING') || run.environment !== 'READY' || run.fault !== 'normal' || get().flight.paused || !fresh(get().sample)) return set({ error: '任务不可开始、遥测无效或故障未修复' }); if (index === 0 && !run.preflightConfirmed) return set({ error: '须完成安全决策' }); if (index > 0 && run.taskResults[index - 1]?.status !== 'PASSED') return set({ error: '前置任务未完成' }); const flight = get().flight; if (index === 0 ? flight.airborne || !flight.armed : index === 1 ? !flight.armed || flight.airborne : !flight.airborne || !flight.armed) return set({ error: '无人机状态与当前任务不匹配，请检查解锁和起飞状态' }); const task = run.taskResults[index]!; engine = new TrainingRuleEngine(run.configuration); engine.start(assessmentRuntime.telemetry()); commit(evidence({ ...run, status: 'TRAINING', taskResults: run.taskResults.map((item, position) => position === index ? { ...item, status: 'RUNNING', attempts: item.attempts + 1, startedAt: Date.now() } : item) }, 'TASK', `开始任务 ${task.taskId}`), set); },
  control: (action, value) => {
    const run = get().run; const task = run.taskResults.find((item) => item.status === 'RUNNING');
    if (run.environment !== 'READY' || !task && !['pause', 'resume', 'land'].includes(action)) return set({ error: '请先启动任务或检查模拟环境' });
    const allowed: Record<string, string[]> = { arm: ['arm'], takeoff: ['takeoff'], hover: ['hover'], vertical: ['altitude'], forward: ['forward'], lateral: ['right'], yaw: ['yaw'], target: ['waypoint'], composite: ['hover'], rtl: ['rtl', 'land'] };
    if (task && !allowed[task.taskId]?.includes(action) && !['pause', 'resume', 'land'].includes(action)) return set({ error: '当前任务不允许此操作' });
    try {
      assessmentRuntime.command(action, value);
      if (action === 'pause' || action === 'resume') engine?.interruptStability();
      if (action === 'hover' && task?.taskId === 'hover') engine?.beginHover();
      if (action === 'rtl' || (action === 'hover' && task?.taskId === 'composite')) engine?.acceptCommand();
      commit(evidence({ ...get().run, status: action === 'rtl' ? 'RETURNING' : action === 'pause' ? 'PAUSED' : 'TRAINING', taskResults: action === 'land' && task?.taskId !== 'rtl' ? get().run.taskResults.map((item) => item.status === 'RUNNING' ? { ...item, status: 'INTERRUPTED', reason: '安全降落中断当前任务' } : item) : get().run.taskResults }, 'COMMAND', `${action} 已发送至 Mock Runtime，等待遥测验证`), set);
    } catch (error) { set({ error: error instanceof Error ? error.message : '模拟指令失败' }); }
  },
  answerAnomaly: (answer) => { const run = get().run; if (run.anomalySubmitted && run.configuration.trainingMode === 'exam') return; commit({ ...run, anomalyAnswer: answer, anomalySubmitted: false }, set); },
  selectAnomaly: (answer) => { const run = get().run; if (run.anomalySubmitted && run.configuration.trainingMode === 'exam') return; commit({ ...run, anomalyChoice: answer, anomalySubmitted: false }, set); },
  submitAnomaly: () => { const run = get().run; if (!run.anomalyAnswer || !run.anomalyChoice) return set({ error: '请完成故障原因和处置判断' }); commit(evidence({ ...run, anomalySubmitted: true }, 'ANOMALY', `提交独立教学情境：${run.anomalyAnswer}；${run.anomalyChoice}`), set); },
  submitReview: (taskId, text) => { const run = get().run; if (!taskId || !text.trim() || !run.taskResults.every((task) => task.status === 'PASSED')) return set({ error: '请完成十项任务并提交数据分析' }); commit(evidence({ ...run, reviewTask: taskId, review: text.trim() }, 'ACTION', '提交实验复盘'), set); },
  save: () => { const run = get().run; if (run.status === 'COMPLETED' || run.status === 'ABORTED' || !run.review || !run.reviewTask || !run.taskResults.every((item) => item.status === 'PASSED')) return set({ error: '任务与复盘尚未完成' }); const final = evidence({ ...run, status: 'COMPLETED', completedAt: Date.now(), completedSteps: [...new Set([...run.completedSteps, 7])] }, 'ACTION', '报告结算'); final.report = `实验三 Mock 运行 ${run.runId}，共完成 ${run.taskResults.length} 项任务。`; commit(final, set); try { const existing = listAssessmentRecords(); localStorage.setItem(recordsKey, JSON.stringify([...existing.filter((item) => item.runId !== run.runId), get().run])); } catch { set({ error: '报告保存失败：本地存储空间不足' }); } },
  abort: () => { if (get().run.status === 'COMPLETED' || get().run.status === 'ABORTED') return set({ error: '该 Run 已结束，请新建实验' }); if (get().flight.airborne || get().flight.armed) return set({ error: '请先降落，不能直接退出飞行中的实验' }); assessmentRuntime.stop(); commit(evidence({ ...get().run, status: 'ABORTED', environment: 'STOPPED', completedAt: Date.now() }, 'SAFETY', '实验中止'), set); },
  advance: () => { const run = get().run; const gates = [run.quizSubmitted && run.learnedParts.length === parts.length, run.configurationConfirmed && validConfig(run.configuration), run.sceneConfirmed, run.environment === 'READY', run.diagnosticSubmitted, run.preflightConfirmed && run.safetyPassed, run.taskResults.every((item) => item.status === 'PASSED') && run.anomalySubmitted][run.step]; if (!gates) return set({ error: '本阶段完成条件尚未满足' }); commit(evidence({ ...run, step: Math.min(7, run.step + 1), completedSteps: [...new Set([...run.completedSteps, run.step])] }, 'ACTION', `完成阶段 ${run.step + 1}`), set); },
  goTo: (step) => { const run = get().run; if (step >= 0 && step <= run.step) set({ run: { ...run, step } }); },
}));
export const taskPoints: Record<string, number> = { arm: 2, takeoff: 4, hover: 5, vertical: 3, forward: 4, lateral: 3, yaw: 3, target: 4, composite: 3, rtl: 4 };
export const listAssessmentRecords = (): ExperimentRun[] => { try { return JSON.parse(localStorage.getItem(recordsKey) ?? '[]') as ExperimentRun[]; } catch { return []; } };
