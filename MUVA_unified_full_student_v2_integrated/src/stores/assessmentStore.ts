import { create } from 'zustand';
import { services } from '../services/serviceRegistry';
import { TrainingRuleEngine } from '../domain/assessment/TrainingRuleEngine';
import { scoreRun } from '../domain/assessment/ScoringEngine';
import { createRun, diagnosticQuestions, experimentId, parts, questions, scenes, tasks, type AssessmentConfig, type Evidence, type ExperimentRun, type Fault, type SimulationSnapshot } from '../domain/assessment/model';
import type { TelemetrySample } from '../types/telemetry';
import { isRealTelemetryReady } from '../services/assessment/coordinates';
import { getExperiment3Scene, restoreExperiment3Scene } from '../domain/assessment/experiment3Scenes';
import { answerTheoryQuestion, beginTheoryExam, createTheoryExamAttempt, remainingExamSeconds } from '../domain/assessment/ExamEngine';
import { scoreTheoryExam } from '../domain/assessment/ExamScoringEngine';
import { assessRun, buildAssessmentReport, hasAcknowledgedCriticalRisk } from '../domain/assessment/OverallScoringEngine';

const realMode = services.assessmentAdapter.source === 'real';
const activeKey = realMode ? 'muva-assessment-real-active-v2' : 'muva-assessment-active-v2';
const recordsKey = realMode ? 'muva-assessment-real-records-v2' : 'muva-assessment-records-v2';
const assessmentRuntime = services.assessment;
const initial = assessmentRuntime.snapshot();
const restore = (): ExperimentRun => {
  try {
    const value = JSON.parse(localStorage.getItem(activeKey) ?? 'null') as (ExperimentRun & { scene?: string | null }) | null;
    if (value?.experimentId === experimentId && Array.isArray(value.taskResults)) return {
      ...createRun(), ...normalizeSceneRun(value), environment: 'STOPPED', safetyPassed: value.step === 7 && value.safetyPassed, preflightConfirmed: value.step === 7 && value.preflightConfirmed,
      status: value.status === 'COMPLETED' || value.status === 'ABORTED' || value.status === 'FAILED' ? value.status : 'INTERRUPTED',
      step: value.step === 7 || value.theoryExam?.status === 'IN_PROGRESS' || value.theoryExam?.status === 'SUBMITTED' ? 7 : value.status === 'COMPLETED' || value.status === 'FAILED' || value.status === 'ABORTED' ? value.step : value.step >= 6 && value.taskResults.some((task) => task.attempts > 0) ? 7 : value.step > 3 ? 3 : value.step,
      completedSteps: value.status === 'COMPLETED' || value.status === 'ABORTED' || value.status === 'FAILED' ? value.completedSteps : value.completedSteps.filter((step) => step < 3),
      taskResults: value.taskResults.map((task) => task.status === 'RUNNING' ? { ...task, status: 'INTERRUPTED', reason: '刷新后模拟已停止' } : task),
    };
  } catch { return createRun(); }
  return createRun();
};
function normalizeSceneRun(value: ExperimentRun & { scene?: string | null }): ExperimentRun {
  const { scene: legacyScene, ...run } = value;
  const selectedSceneId = restoreExperiment3Scene({ selectedSceneId: run.selectedSceneId, scene: legacyScene });
  return updateAssessment({ ...createRun(), ...run, theoryExam: run.theoryExam ?? createTheoryExamAttempt(), selectedSceneId, sceneConfirmed: !!selectedSceneId && run.sceneConfirmed });
}
function updateAssessment(run: ExperimentRun): ExperimentRun {
  const assessment = assessRun(run);
  return { ...run, practiceScore: assessment.practiceScore, theoryScore: assessment.theoryScore, overallScore: assessment.overallScore, practiceStatus: assessment.practiceStatus, examStatus: assessment.examStatus, overallStatus: assessment.overallStatus, seriousSafetyViolation: assessment.seriousSafetyViolation };
}
const evidence = (run: ExperimentRun, type: Evidence['type'], message: string, sample?: TelemetrySample, metadata?: Pick<Evidence, 'responsibility' | 'severity' | 'ruleId'>): ExperimentRun => ({ ...run, evidence: [...run.evidence, { id: crypto.randomUUID(), runId: run.runId, timestamp: Date.now(), type, message, sample, ...metadata }].slice(-1000) });
const commit = (run: ExperimentRun, set: (change: Partial<State>) => void) => {
  const scored = updateAssessment({ ...run, scoreBreakdown: run.assessmentReport ? run.scoreBreakdown : scoreRun(run) });
  try { localStorage.setItem(activeKey, JSON.stringify(scored)); }
  catch { set({ run: scored, error: '自动保存失败：本地存储不可用，答案暂留内存，请清理存储后重试。' }); return; }
  set({ run: scored, error: '' });
};
export const validConfig = (config: AssessmentConfig) => Number.isFinite(config.altitude) && config.altitude >= 2 && config.altitude <= 30 && Number.isFinite(config.speed) && config.speed > 0 && config.speed <= 5 && Number.isFinite(config.hoverSeconds) && config.hoverSeconds >= 3 && config.hoverSeconds <= 60 && ['GUIDED', 'LOITER'].includes(config.mode) && ['guided', 'practice', 'exam'].includes(config.trainingMode) && ['beginner', 'intermediate', 'advanced'].includes(config.difficulty ?? 'beginner');
const fresh = (sample: TelemetrySample | null) => !!sample && sample.timestamp > 0 && Date.now() - sample.timestamp < 3000 && sample.mavlinkStatus.connected;
export const diagnosis = (run: ExperimentRun, sample: TelemetrySample | null) => [
  { name: 'GPS', status: !fresh(sample) ? 'UNKNOWN / STALE' : sample!.gpsSatellites >= 6 ? 'PASS' : 'FAIL', source: '模拟卫星数', impact: '航点和定位' },
  { name: 'IMU', status: !fresh(sample) ? 'UNKNOWN / STALE' : 'PASS', source: '模拟惯导', impact: '姿态控制' },
  { name: 'EKF', status: !fresh(sample) ? 'UNKNOWN / STALE' : sample!.ekfStatus.healthy ? 'PASS' : 'FAIL', source: '模拟估计器', impact: '位置融合' },
  { name: '电池', status: !fresh(sample) ? 'UNKNOWN / STALE' : sample!.batteryPercent >= 20 ? 'PASS' : 'FAIL', source: '模拟电量', impact: '返航余量' },
  { name: '心跳 / 通信', status: !fresh(sample) ? 'UNKNOWN / STALE' : 'PASS', source: '模拟通信链路', impact: '命令控制' },
  { name: '飞行模式', status: !fresh(sample) ? 'UNKNOWN / STALE' : sample!.mode === 'GUIDED' ? 'PASS' : 'FAIL', source: '模拟模式', impact: '位置任务' },
  { name: '位置与姿态', status: !fresh(sample) ? 'UNKNOWN / STALE' : Number.isFinite(sample!.position.latitude) ? 'PASS' : 'FAIL', source: '模拟遥测', impact: '导航' },
  { name: '飞控综合健康', status: run.fault === 'normal' ? 'PASS' : 'FAIL', source: '教学情境', impact: '请根据异常读数判断原因' },
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
  hydrate: () => void; release: () => void; newRun: () => void; restartTraining: () => void; learn: (part: string) => void; answerQuiz: (id: string, answer: string) => void; submitQuiz: () => void;
  configure: (config: AssessmentConfig, answer: string) => void; chooseScene: (id: string) => void; confirmScene: () => void;
  setStartupFailure: (failure?: ExperimentRun['simulationFailure']) => void; start: () => Promise<void>; stop: () => Promise<void>;
  setFault: (fault: Fault) => void; generateFault: () => void; resolveFault: (guess: Fault, remedy: string) => void; answerDiagnosis: (id: string, answer: string) => void; submitDiagnosis: () => void;
  checkSafety: () => void; confirmSafety: () => void; armSafety: () => void; setGuided: () => void; startTask: () => void; control: (action: string, value?: number | { x: number; z: number }) => void;
  answerAnomaly: (answer: string) => void; selectAnomaly: (answer: string) => void; submitAnomaly: () => void; submitReview: (taskId: string, text: string) => void; save: () => void; abort: () => void;
  startExam: () => void; answerExam: (questionId: string, answers: string[]) => void; selectExamQuestion: (index: number) => void; submitExam: (reason?: 'manual' | 'timeout') => void; openAssessment: () => void;
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
    if (get().run.theoryExam.status === 'IN_PROGRESS' && remainingExamSeconds(get().run.theoryExam) === 0) get().submitExam('timeout');
    if (unsubscribe) return;
    unsubscribe = assessmentRuntime.subscribe((flight) => {
      set({ flight });
      const run = get().run;
      if (run.environment !== 'READY') return;
      const sample = assessmentRuntime.telemetry();
      set({ sample });
      if (Date.now() - lastEvaluated < 100 || flight.paused) return;
      lastEvaluated = Date.now();
      const active = run.taskResults.find((item) => item.status === 'RUNNING');
      const result = active && engine && fresh(sample) ? engine.evaluate(active, sample) : active;
      const track = run.telemetrySummary.track;
      let next: ExperimentRun = { ...run };
      if (Date.now() - lastTrace >= 500 && sample.timestamp > 0) {
        lastTrace = Date.now();
        next = { ...next, trajectory: [...next.trajectory, { timestamp: sample.timestamp, ...flight.position, ...flight.attitude, ...flight.velocity, taskId: active?.taskId, battery: sample.batteryPercent, mode: flight.mode, armed: flight.armed }].slice(-2500), telemetrySummary: { samples: run.telemetrySummary.samples + 1, maxAltitude: Math.max(run.telemetrySummary.maxAltitude, flight.position.y), maxSpeed: Math.max(run.telemetrySummary.maxSpeed, sample.speedMetersPerSecond), track: [...track, { north: -flight.position.z, east: flight.position.x, altitude: flight.position.y, timestamp: sample.timestamp }].slice(-2500) } };
      }
      const scene = scenes.find((item) => item.id === run.selectedSceneId);
      const risk = scene && (Math.abs(flight.position.x - scene.homePosition.x) > scene.trainingArea.width / 2 || Math.abs(flight.position.z - scene.homePosition.z) > scene.trainingArea.length / 2) ? '飞出安全区域' : scene?.obstacles.some((item) => Math.abs(flight.position.x - item.position[0]) < item.size[0] / 2 + 1 && Math.abs(flight.position.z - item.position[2]) < item.size[2] / 2 + 1 && flight.position.y < item.position[1] + item.size[1] / 2 + 1) ? '接近障碍物' : flight.position.y > Math.max(30, run.configuration.altitude + 3) ? '高度超限' : sample.batteryPercent < 10 ? '电量严重不足' : null;
      const timeout = active?.startedAt && Date.now() - active.startedAt > Math.max(180, run.configuration.hoverSeconds * 3) * 1000;
      if (active && !fresh(sample)) {
        next.taskResults = run.taskResults.map((item) => item.taskId === active.taskId ? { ...item, status: 'INTERRUPTED', reason: '遥测中断', completedAt: Date.now() } : item);
        next = evidence({ ...next, status: 'INTERRUPTED', trajectory: [...next.trajectory, { timestamp: Date.now(), ...flight.position, ...flight.attitude, ...flight.velocity, taskId: active.taskId, event: '遥测中断' }].slice(-2500) }, 'SAFETY', '遥测中断，等待故障修复', sample);
      }
      else if (active && (risk || timeout)) {
        const reason = risk ?? '任务超时';
        engine?.interruptStability();
        next.taskResults = run.taskResults.map((item) => item.taskId === active.taskId ? { ...item, status: run.configuration.trainingMode === 'exam' ? 'FAILED' : 'INTERRUPTED', reason, completedAt: Date.now() } : item);
        next = evidence({ ...next, status: 'INTERRUPTED', trajectory: [...next.trajectory, { timestamp: Date.now(), ...flight.position, ...flight.attitude, ...flight.velocity, taskId: active.taskId, event: reason }].slice(-2500) }, 'SAFETY', reason, sample);
        if (risk) { engine?.pause(); assessmentRuntime.command('pause'); }
      } else if (active && result && result !== active) {
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
        if (Date.now() - lastSaved > 3000 || result?.status === 'PASSED' || risk || timeout || next.status === 'INTERRUPTED') { lastSaved = Date.now(); commit(next, set); }
      }
    });
  },
  release: () => {
    unsubscribe?.(); unsubscribe = null;
    const run = get().run;
    if (run.environment === 'READY' || run.environment === 'STARTING') {
      assessmentRuntime.stop(); engine = null;
      commit(evidence({ ...run, environment: 'STOPPED', status: 'INTERRUPTED', safetyPassed: false, preflightConfirmed: false, taskResults: run.taskResults.map((task) => task.status === 'RUNNING' ? { ...task, status: 'INTERRUPTED', completedAt: Date.now(), reason: '页面已离开，飞行会话终止' } : task) }, 'SAFETY', '页面离开，Mock 会话终止'), set);
      set({ flight: assessmentRuntime.snapshot(), sample: null, startupBusy: false });
    }
  },
  newRun: () => { if (get().flight.airborne || get().flight.armed) return set({ error: '请先安全降落' }); assessmentRuntime.stop(); engine = null; commit(createRun(), set); set({ flight: assessmentRuntime.snapshot(), sample: null }); },
  restartTraining: () => {
    const run = get().run;
    if (run.theoryExam.status !== 'NOT_STARTED' || run.assessmentReport) return set({ error: '考卷已经开始，需新建实验才能重试实操' });
    if (['COMPLETED', 'FAILED', 'ABORTED'].includes(run.status) || get().flight.armed || get().flight.airborne) return set({ error: '请先降落；已结算成绩请新建 Run' });
    assessmentRuntime.stop(); engine = null; const reset = createRun();
    commit(evidence({ ...run, step: 3, status: 'INTERRUPTED', environment: 'STOPPED', safetyPassed: false, preflightConfirmed: false, taskResults: reset.taskResults, taskScores: {}, trajectory: [], telemetrySummary: reset.telemetrySummary, hoverBreaks: 0, completedSteps: run.completedSteps.filter((step) => step < 3), anomalySubmitted: false }, 'SAFETY', '重置训练后需重新模拟启动及安全检查'), set);
    set({ sample: null });
  },
  learn: (id) => { const run = get().run; if (!parts.some((part) => part.id === id) || run.status === 'COMPLETED') return; commit({ ...run, learnedParts: [...new Set([...run.learnedParts, id])] }, set); },
  answerQuiz: (id, answer) => { const run = get().run; if (run.status === 'COMPLETED' || run.quizSubmitted && run.configuration.trainingMode === 'exam') return; commit({ ...run, quizAnswers: { ...run.quizAnswers, [id]: answer }, quizSubmitted: false }, set); },
  submitQuiz: () => { const run = get().run; if (run.learnedParts.length < parts.length || !questions.every((question) => run.quizAnswers[question.id])) return set({ error: '请学习八个部件并完成全部测验' }); commit(evidence({ ...run, quizSubmitted: true }, 'ACTION', '知识测验已提交'), set); if (!questions.every((question) => run.quizAnswers[question.id] === question.answer)) set({ error: '请根据错题解析修正答案后再进入下一阶段' }); },
  configure: (configuration, answer) => { const run = get().run; if (run.theoryExam.status !== 'NOT_STARTED' || run.assessmentReport || run.environment !== 'STOPPED' || run.status === 'COMPLETED') return set({ error: '请先停止模拟环境' }); if (!validConfig(configuration) || !answer) return set({ error: '高度 2–30m、速度 0–5m/s、悬停 3–60s，并完成参数理解题' }); const reset = createRun(); engine = null; commit(evidence({ ...run, step: 1, status: 'CONFIGURING', configuration, configurationConfirmed: true, parameterAnswer: answer, completedSteps: run.completedSteps.filter((step) => step < 1), sceneConfirmed: false, taskResults: reset.taskResults, taskScores: {}, trajectory: [], telemetrySummary: reset.telemetrySummary, safetyPassed: false, preflightConfirmed: false }, 'ACTION', '参数已确认，后续任务重新生成'), set); },
  chooseScene: (id) => { const run = get().run; if (run.theoryExam.status !== 'NOT_STARTED' || run.assessmentReport || run.environment !== 'STOPPED' || get().startupBusy || !getExperiment3Scene(id)) return set({ error: '需停止环境并选择已开放场景' }); if (run.selectedSceneId === id) return; const reset = createRun(); engine = null; commit({ ...run, selectedSceneId: id, sceneConfirmed: false, safetyPassed: false, preflightConfirmed: false, taskResults: reset.taskResults, taskScores: {}, trajectory: [], telemetrySummary: reset.telemetrySummary, completedSteps: run.completedSteps.filter((step) => step < 2) }, set); },
  confirmScene: () => { const run = get().run; if (realMode) return set({ error: '真实模式无法验证当前 Gazebo World；仅支持只读遥测，不确认前端模拟场景为真实场景' }); if (!getExperiment3Scene(run.selectedSceneId)) return set({ error: '请选择已开放场景' }); commit(evidence({ ...run, sceneConfirmed: true }, 'ACTION', `确认前端模拟场景 ${run.selectedSceneId}`), set); },
  setStartupFailure: (simulationFailure) => commit({ ...get().run, simulationFailure }, set),
  start: async () => {
    if (realMode) return set({ error: '真实模式禁止启动共享 SITL：网关缺少跨实验会话原子资源所有权' });
    const run = get().run; if (get().startupBusy || !run.sceneConfirmed || !getExperiment3Scene(run.selectedSceneId) || run.environment === 'READY') return set({ error: '请先确认场景或等待当前启动完成' });
    set({ startupBusy: true }); commit({ ...run, environment: 'STARTING', status: 'ENVIRONMENT_STARTING', simulationLog: [] }, set);
    const phases = ['加载前端场景资源', '初始化 Mock 飞控', '建立模拟数据通信', '启动遥测生成器', '校验初始状态'];
    for (let index = 0; index < phases.length; index++) {
      await sleep(400);
      if (get().run.runId !== run.runId || get().run.environment !== 'STARTING') { set({ startupBusy: false }); return; }
      if ((run.simulationFailure === 'scene' && index === 0) || (run.simulationFailure === 'link' && index === 2) || (run.simulationFailure === 'telemetry' && index === 3)) {
        commit({ ...get().run, environment: 'FAILED', systemFailure: true, status: 'FAILED', environmentError: `${phases[index]}失败`, simulationLog: [...get().run.simulationLog, `失败：${phases[index]}`] }, set);
        set({ startupBusy: false }); return;
      }
      commit({ ...get().run, simulationLog: [...get().run.simulationLog, `${index + 1}/5 ${phases[index]}完成`] }, set);
    }
    if (get().run.runId !== run.runId || get().run.environment !== 'STARTING') { set({ startupBusy: false }); return; }
    try { assessmentRuntime.start(run.configuration, run.selectedSceneId ?? 'runway'); } catch (error) { commit({ ...get().run, environment: 'FAILED', systemFailure: true, status: 'FAILED', environmentError: error instanceof Error ? error.message : '启动失败' }, set); set({ startupBusy: false }); return; }
    commit(evidence({ ...get().run, environment: 'READY', systemFailure: false, status: 'READY', fault: 'normal', environmentError: undefined }, 'ACTION', 'Mock 环境 READY'), set);
    set({ startupBusy: false, sample: assessmentRuntime.telemetry() });
  },
  stop: async () => { if (realMode) return set({ error: '只读模式不允许停止其他实验的共享仿真' }); const run = get().run; if (get().flight.armed || get().flight.airborne) return set({ error: '模拟无人机未着陆，无法停止' }); commit({ ...run, environment: 'STOPPING' }, set); await sleep(250); assessmentRuntime.stop(); engine = null; commit(evidence({ ...get().run, environment: 'STOPPED', status: 'INTERRUPTED', safetyPassed: false, preflightConfirmed: false, taskResults: get().run.taskResults.map((item) => item.status === 'RUNNING' ? { ...item, status: 'INTERRUPTED', reason: '环境已停止' } : item) }, 'ACTION', '模拟环境已停止'), set); set({ sample: null }); },
  setFault: (fault) => {
    const run = get().run;
    if (run.status === 'COMPLETED' || run.environment !== 'READY') return;
    assessmentRuntime.setFault(fault);
    if (fault !== 'normal') engine?.interruptStability();
    commit(evidence({ ...run, fault, status: fault !== 'normal' && run.taskResults.some((item) => item.status === 'RUNNING') ? 'INTERRUPTED' : run.status, safetyPassed: false, preflightConfirmed: false, taskResults: fault !== 'normal' ? run.taskResults.map((item) => item.status === 'RUNNING' ? { ...item, status: 'INTERRUPTED', reason: `模拟 ${fault} 异常，任务中断`, completedAt: Date.now() } : item) : run.taskResults }, 'DIAGNOSTIC', `切换教学情境：${fault}`), set);
    set({ sample: assessmentRuntime.telemetry() });
  },
  generateFault: () => {
    const run = get().run;
    if (run.environment !== 'READY' || get().flight.armed) return set({ error: '仅在地面就绪状态可进行诊断情境' });
    const faults: Fault[] = ['gps', 'ekf', 'battery', 'link'];
    const fault = faults[(run.faultCaseAttempts ?? 0) % faults.length]!;
    assessmentRuntime.setFault(fault);
    commit(evidence({ ...run, fault, faultCasePassed: false, faultCaseAttempts: (run.faultCaseAttempts ?? 0) + 1, safetyPassed: false, preflightConfirmed: false }, 'DIAGNOSTIC', '故障情境已生成；请观察模拟传感器数据'), set);
    set({ sample: assessmentRuntime.telemetry() });
  },
  resolveFault: (guess, remedy) => {
    const run = get().run;
    const remedies: Record<Exclude<Fault, 'normal'>, string> = { gps: '重新获取定位', ekf: '重新校准惯导', battery: '更换电池', link: '重建通信链路' };
    if (run.fault === 'normal') return set({ error: '请先生成故障情境' });
    if (guess !== run.fault || remedy !== remedies[run.fault]) {
      commit(evidence(run, 'DIAGNOSTIC', `排障尝试未通过：判断 ${guess}，处置 ${remedy}`), set);
      return set({ error: guess !== run.fault ? '判断与当前异常读数不符，请对照传感器数据重试' : '故障类型正确，但处置方式不适用，请重新选择' });
    }
    assessmentRuntime.setFault('normal');
    commit(evidence({ ...run, fault: 'normal', faultCasePassed: true }, 'DIAGNOSTIC', `排障通过：${guess} → ${remedy} → 遥测复检`), set);
    set({ sample: assessmentRuntime.telemetry() });
  },
  answerDiagnosis: (id, answer) => { const run = get().run; if (run.configuration.trainingMode === 'exam' && run.diagnosticSubmitted) return; commit({ ...run, diagnosticAnswers: { ...run.diagnosticAnswers, [id]: answer }, diagnosticSubmitted: false }, set); },
  submitDiagnosis: () => { const run = get().run; if (!diagnosticQuestions.every((question) => run.diagnosticAnswers[question.id])) return set({ error: '请完成诊断问答' }); commit(evidence({ ...run, diagnosticSubmitted: true }, 'DIAGNOSTIC', `已提交诊断，情境 ${run.fault}`), set); if (!diagnosticQuestions.every((question) => run.diagnosticAnswers[question.id] === question.answer)) set({ error: '诊断不正确，请观察异常数据并重新判断' }); },
  checkSafety: () => { const run = get().run; const failures = safetyChecks(run, get().sample).filter(([, pass]) => !pass); commit(evidence({ ...run, safetyPassed: failures.length === 0, preflightConfirmed: false }, 'SAFETY', failures.length ? `安全检查失败：${failures.map(([name]) => name).join('、')}` : '安全检查通过（未解锁）'), set); if (failures.length) set({ error: `未通过：${failures.map(([name]) => name).join('、')}` }); },
  confirmSafety: () => { const run = get().run; if (!run.safetyPassed || safetyChecks(run, get().sample).some(([, pass]) => !pass)) return set({ error: '需重新通过全部检查' }); commit(evidence({ ...run, preflightConfirmed: true }, 'SAFETY', '确认起飞安全决策'), set); },
  armSafety: () => { const run = get().run; if (!run.preflightConfirmed || run.environment !== 'READY' || run.fault !== 'normal' || safetyChecks(run, get().sample).filter(([name]) => name !== '尚未解锁').some(([, passed]) => !passed)) return set({ error: '请先通过并确认安全检查' }); try { assessmentRuntime.command('arm'); commit(evidence(run, 'COMMAND', '模拟 ARM 已完成，飞行器尚未起飞'), set); } catch (error) { set({ error: error instanceof Error ? error.message : '解锁失败' }); } },
  setGuided: () => { try { assessmentRuntime.command('guided'); commit(evidence({ ...get().run, safetyPassed: false, preflightConfirmed: false }, 'COMMAND', '模拟飞行模式切换为 GUIDED'), set); } catch (error) { set({ error: error instanceof Error ? error.message : '切换失败' }); } },
  startTask: () => { const run = get().run; const index = run.taskResults.findIndex((item) => item.status === 'READY' || item.status === 'INTERRUPTED' && run.configuration.trainingMode !== 'exam'); if (index < 0 || run.status === 'COMPLETED' || run.status === 'ABORTED' || run.taskResults.some((item) => item.status === 'RUNNING') || run.environment !== 'READY' || run.fault !== 'normal' || get().flight.paused || !fresh(get().sample)) return set({ error: '任务不可开始、遥测无效或故障未修复' }); if (index === 0 && !run.preflightConfirmed) return set({ error: '须完成安全决策' }); if (index > 0 && run.taskResults[index - 1]?.status !== 'PASSED') return set({ error: '前置任务未完成' }); const flight = get().flight; if (index === 0 ? flight.airborne || !flight.armed : index === 1 ? !flight.armed || flight.airborne : !flight.airborne || !flight.armed) return set({ error: '无人机状态与当前任务不匹配，请检查解锁和起飞状态' }); const task = run.taskResults[index]!; engine = new TrainingRuleEngine(run.configuration, scenes.find((item) => item.id === run.selectedSceneId)); engine.start(assessmentRuntime.telemetry()); commit(evidence({ ...run, status: 'TRAINING', taskResults: run.taskResults.map((item, position) => position === index ? { ...item, status: 'RUNNING', attempts: item.attempts + 1, startedAt: Date.now() } : item) }, 'TASK', `开始任务 ${task.taskId}`), set); },
  control: (action, value) => {
    const run = get().run; const task = run.taskResults.find((item) => item.status === 'RUNNING');
    const telemetryBeforeCommand = get().sample;
    const unsafeResume = action === 'resume' && get().flight.airborne && get().flight.paused && hasAcknowledgedCriticalRisk(run, telemetryBeforeCommand);
    if (run.environment !== 'READY' || !task && !['pause', 'resume', 'land'].includes(action)) return set({ error: '请先启动任务或检查模拟环境' });
    if (action === 'pause' && get().flight.paused && run.status === 'INTERRUPTED') return set({ error: '安全中断后请先排查风险，再选择继续或安全降落' });
    const allowed: Record<string, string[]> = { arm: ['arm'], takeoff: ['takeoff'], hover: ['hover'], vertical: ['altitude'], forward: ['forward', 'backward', 'hover'], lateral: ['right', 'left', 'hover'], yaw: ['yaw', 'hover'], target: ['waypoint', 'forward', 'backward', 'right', 'left', 'hover'], composite: ['hover', 'forward', 'backward', 'right', 'left', 'yaw', 'altitude'], rtl: ['rtl', 'land'] };
    if (task && !allowed[task.taskId]?.includes(action) && !['pause', 'resume', 'land'].includes(action)) return set({ error: '当前任务不允许此操作' });
    try {
      assessmentRuntime.command(action, value);
      if (action === 'pause') engine?.pause();
      if (action === 'resume') engine?.resume();
      if (action === 'hover' && task?.taskId === 'hover') engine?.beginHover();
      if (action === 'rtl' || (action === 'hover' && task?.taskId === 'composite')) engine?.acceptCommand();
      let current = get().run;
      if (unsafeResume) current = evidence(current, 'SAFETY', '忽略已提示的关键风险并主动恢复飞行', telemetryBeforeCommand ?? undefined, { responsibility: 'student', severity: 'serious', ruleId: 'critical-safety-v1' });
      const pausedDuration = action === 'resume' && current.pauseStartedAt ? Math.max(0, Date.now() - current.pauseStartedAt) : 0;
      commit(evidence({ ...current, status: action === 'rtl' ? 'RETURNING' : action === 'pause' ? 'PAUSED' : action === 'land' && task?.taskId !== 'rtl' ? 'INTERRUPTED' : 'TRAINING', pauseStartedAt: action === 'pause' ? Date.now() : undefined, taskResults: current.taskResults.map((item) => item.status === 'RUNNING' ? action === 'land' && item.taskId !== 'rtl' ? { ...item, status: 'INTERRUPTED', reason: '安全降落中断当前任务', completedAt: Date.now() } : pausedDuration && item.startedAt ? { ...item, startedAt: item.startedAt + pausedDuration } : item : item) }, 'COMMAND', `${action} 已发送至 Mock Runtime，等待遥测验证`), set);
    } catch (error) { set({ error: error instanceof Error ? error.message : '模拟指令失败' }); }
  },
  answerAnomaly: (answer) => { const run = get().run; if (run.anomalySubmitted && run.configuration.trainingMode === 'exam') return; commit({ ...run, anomalyAnswer: answer, anomalySubmitted: false }, set); },
  selectAnomaly: (answer) => { const run = get().run; if (run.anomalySubmitted && run.configuration.trainingMode === 'exam') return; commit({ ...run, anomalyChoice: answer, anomalySubmitted: false }, set); },
  submitAnomaly: () => { const run = get().run; if (!run.anomalyAnswer || !run.anomalyChoice) return set({ error: '请完成故障原因和处置判断' }); commit(evidence({ ...run, anomalySubmitted: true }, 'ANOMALY', `提交独立教学情境：${run.anomalyAnswer}；${run.anomalyChoice}`), set); },
  submitReview: (taskId, text) => { const run = get().run; if (run.assessmentReport) return set({ error: '已保存报告不可修改' }); if (!taskId || !text.trim() || !run.taskResults.some((task) => task.taskId === taskId)) return set({ error: '选择任务并填写复盘分析' }); commit(evidence({ ...run, reviewTask: taskId, review: text.trim() }, 'ACTION', '提交实验复盘'), set); },
  openAssessment: () => {
    if (realMode || get().flight.airborne || get().flight.armed || get().startupBusy) return set({ error: '请先安全降落并结束启动任务' });
    const run = get().run;
    assessmentRuntime.stop(); engine = null;
    commit({ ...run, step: 7, environment: 'STOPPED', taskResults: run.taskResults.map((task) => task.status === 'RUNNING' ? { ...task, status: 'INTERRUPTED', reason: '实操提前结束', completedAt: Date.now() } : task) }, set);
  },
  startExam: () => {
    const run = get().run;
    if (realMode || run.step !== 7 || run.theoryExam.status !== 'NOT_STARTED' || run.assessmentReport || get().flight.airborne || get().flight.armed) return set({ error: '请在第八阶段安全落地后开始考卷' });
    assessmentRuntime.stop(); engine = null;
    commit(evidence({ ...run, environment: 'STOPPED', theoryExam: beginTheoryExam(run) }, 'ACTION', '开始终结性理论考卷 · 题目快照已固定'), set);
    set({ sample: null });
  },
  answerExam: (questionId, answers) => {
    const run = get().run;
    if (run.assessmentReport || run.theoryExam.status !== 'IN_PROGRESS') return;
    if (remainingExamSeconds(run.theoryExam) === 0) return get().submitExam('timeout');
    const theoryExam = answerTheoryQuestion(run.theoryExam, questionId, answers);
    if (theoryExam !== run.theoryExam) commit({ ...run, theoryExam }, set);
  },
  selectExamQuestion: (index) => {
    const run = get().run;
    if (index < 0 || index >= run.theoryExam.questionSnapshot.length || !Number.isInteger(index) || run.assessmentReport) return;
    commit({ ...run, theoryExam: { ...run.theoryExam, currentQuestionIndex: index } }, set);
  },
  submitExam: (reason = 'manual') => {
    const run = get().run;
    if (run.theoryExam.status !== 'IN_PROGRESS' || run.assessmentReport) return;
    const submissionReason = remainingExamSeconds(run.theoryExam) === 0 ? 'timeout' : reason;
    if (submissionReason === 'timeout' && remainingExamSeconds(run.theoryExam) > 0) return;
    commit(evidence({ ...run, theoryExam: scoreTheoryExam(run.theoryExam, Date.now(), submissionReason) }, 'SCORE', submissionReason === 'timeout' ? '理论考卷到时自动提交' : '理论考卷提交 · 标准答案与判分结果已固定'), set);
  },
  save: () => {
    const run = get().run;
    if (run.assessmentReport) return set({ error: '已结算记录不可重复保存' });
    if (!run.review || !run.reviewTask || run.theoryExam.status !== 'SUBMITTED') return set({ error: '请先提交理论考卷和实操复盘内容' });
    if (get().flight.airborne || get().flight.armed) return set({ error: '请先安全降落，或等待飞行中断后再结算' });
    assessmentRuntime.stop(); engine = null;
    const completedAt = Date.now();
    const base = { ...run, scoreBreakdown: scoreRun(run), environment: 'STOPPED' as const, taskResults: run.taskResults.map((task) => task.status === 'RUNNING' ? { ...task, status: 'INTERRUPTED' as const, completedAt, reason: '提前结束' } : task) };
    const assessmentReport = buildAssessmentReport(base, completedAt);
    const final = evidence({ ...base, assessmentReport, completedAt, status: run.status === 'ABORTED' ? 'ABORTED' : assessmentReport.overallStatus === 'PASSED' ? 'COMPLETED' : 'FAILED', completedSteps: [...new Set([...run.completedSteps, 7])] }, 'ACTION', '理论与实操综合报告结算');
    final.report = `实验三 Run ${run.runId}：实操 ${assessmentReport.practiceScore} 分，理论 ${assessmentReport.theoryScore} 分，综合 ${assessmentReport.overallScore} 分；结论 ${assessmentReport.overallStatus}。`;
    const scored = updateAssessment(final);
    try { localStorage.setItem(recordsKey, JSON.stringify([...listAssessmentRecords().filter((item) => item.runId !== run.runId), scored])); }
    catch { return set({ error: '报告保存失败：本地存储空间不足，请清理后重试' }); }
    commit(scored, set); set({ sample: null });
  },
  abort: () => { if (get().run.status === 'COMPLETED' || get().run.status === 'ABORTED') return set({ error: '该 Run 已结束，请新建实验' }); if (get().flight.airborne || get().flight.armed) return set({ error: '请先降落，不能直接退出飞行中的实验' }); assessmentRuntime.stop(); engine = null; commit(evidence({ ...get().run, status: 'ABORTED', step: 7, environment: 'STOPPED', completedAt: Date.now(), taskResults: get().run.taskResults.map((item) => item.status === 'RUNNING' ? { ...item, status: 'INTERRUPTED', reason: '学生主动中止', completedAt: Date.now() } : item) }, 'SAFETY', '实验中止'), set); set({ sample: null }); },
  advance: () => { const run = get().run; const gates = [run.quizSubmitted && run.learnedParts.length === parts.length && questions.every((question) => run.quizAnswers[question.id] === question.answer), run.configurationConfirmed && validConfig(run.configuration), run.sceneConfirmed, run.environment === 'READY', run.diagnosticSubmitted && run.faultCasePassed && diagnosticQuestions.every((question) => run.diagnosticAnswers[question.id] === question.answer), run.preflightConfirmed && run.safetyPassed, run.taskResults.every((item) => item.status === 'PASSED') && run.anomalySubmitted || run.step === 6 && (run.status === 'INTERRUPTED' || run.status === 'FAILED' || run.status === 'ABORTED')][run.step]; if (!gates) return set({ error: '本阶段完成条件尚未满足' }); commit(evidence({ ...run, step: Math.min(7, run.step + 1), completedSteps: [...new Set([...run.completedSteps, run.step])] }, 'ACTION', `完成阶段 ${run.step + 1}`), set); },
  goTo: (step) => { const run = get().run; if (run.theoryExam.status !== 'NOT_STARTED' && step !== 7) return set({ error: '考卷开始后实操数据锁定，请完成考核与报告' }); if (step >= 0 && step <= run.step) set({ run: { ...run, step } }); },
}));
export const taskPoints: Record<string, number> = { arm: 2, takeoff: 4, hover: 5, vertical: 3, forward: 4, lateral: 3, yaw: 3, target: 4, composite: 3, rtl: 4 };
export const listAssessmentRecords = (): ExperimentRun[] => { try { return (JSON.parse(localStorage.getItem(recordsKey) ?? '[]') as (ExperimentRun & { scene?: string | null })[]).map(normalizeSceneRun); } catch { return []; } };
