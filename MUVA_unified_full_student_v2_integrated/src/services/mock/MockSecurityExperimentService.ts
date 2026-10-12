import type { SecurityExperimentService, SecurityTelemetryHandler } from '../contracts';
import { detectSecurityEvidence, type SecurityDetectorState } from '../../domain/securityDetection';
import type { SecurityCase, SecurityConfig, SecurityEvidence, SecurityJudgment, SecurityReport, SecurityRun, SecurityTelemetry } from '../../types/securityExperiment';

interface ActiveRun { run: SecurityRun; timer: ReturnType<typeof setInterval> | null; tick: number; detector: SecurityDetectorState; replaySample: SecurityTelemetry | null; baselineSequences: number[]; recovered: number; reflection: string; judgmentsSeen: Set<string>; actualCase: Exclude<SecurityCase, 'hidden'>; seed: number; recoveryStartedAt: number | null; recoveryMs: number | null; finalReport: SecurityReport | null; }

export class MockSecurityExperimentService implements SecurityExperimentService {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly listeners = new Map<string, Set<{ sample: SecurityTelemetryHandler; evidence: (items: SecurityEvidence[]) => void }>>();
  private readonly history: SecurityReport[] = [];

  async createRun(config: SecurityConfig): Promise<SecurityRun> {
    const runId = crypto.randomUUID();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    const actualCase: Exclude<SecurityCase, 'hidden'> = config.mode === 'assessment' ? (seed % 2 === 0 ? 'replay' : 'degradation') : config.caseId === 'degradation' ? 'degradation' : 'replay';
    const run: SecurityRun = { runId, config: { ...config, caseId: config.mode === 'assessment' ? 'hidden' : actualCase }, caseVersion: '1.0', seed: config.mode === 'assessment' ? null : seed, phase: 'preparation', source: 'simulation', telemetry: null, evidence: [], timeline: [{ at: Date.now(), label: '创建独立实验运行', kind: 'run' }], judgment: null, judgments: [], evidenceIds: [], isolation: 'not_submitted', score: null };
    this.runs.set(runId, { run, timer: null, tick: 0, detector: { lastSequence: null, lastReceivedAt: null, lastConnection: null }, replaySample: null, baselineSequences: [], recovered: 0, reflection: '', judgmentsSeen: new Set(), actualCase, seed, recoveryStartedAt: null, recoveryMs: null, finalReport: null });
    return structuredClone(run);
  }
  async getRun(runId: string): Promise<SecurityRun | null> { const run = this.runs.get(runId)?.run; return run ? structuredClone(run) : null; }
  async listReports(): Promise<SecurityReport[]> { return structuredClone(this.history); }
  async startBaseline(runId: string): Promise<SecurityRun> { const active = this.require(runId); if (active.run.phase !== 'preparation') return structuredClone(active.run); active.run.phase = 'baseline'; this.timeline(active, '开始正常遥测对照', 'baseline'); this.schedule(active); return structuredClone(active.run); }
  async startAnomaly(runId: string): Promise<SecurityRun> { const active = this.require(runId); if (active.run.phase !== 'baseline') return structuredClone(active.run); active.run.phase = 'anomaly'; this.timeline(active, '进入案例异常观察阶段', 'anomaly'); return structuredClone(active.run); }
  async submitJudgment(runId: string, judgment: SecurityJudgment, evidenceIds: string[], requestId: string): Promise<SecurityRun> { const active = this.require(runId); if (active.judgmentsSeen.has(requestId)) return structuredClone(active.run); active.judgmentsSeen.add(requestId); const falsePositive = active.run.phase === 'baseline' && judgment !== 'normal'; const item = { judgment, evidenceIds: [...new Set(evidenceIds)], elapsedMs: active.tick * 1000, falsePositive }; active.run.judgments.push(item); if (active.run.phase === 'anomaly') { active.run.judgment = judgment; active.run.evidenceIds = item.evidenceIds; } this.timeline(active, `学生提交判断：${judgment}${falsePositive ? '（正常对照误报）' : ''}`, 'judgment'); return structuredClone(active.run); }
  async isolate(runId: string): Promise<SecurityRun> { const active = this.require(runId); if (active.run.isolation !== 'not_submitted') return structuredClone(active.run); active.run.isolation = 'submitted'; this.timeline(active, '提交当前实验通道异常数据隔离请求', 'action'); await Promise.resolve(); active.run.isolation = 'accepted'; this.timeline(active, '隔离请求已接受', 'action'); active.run.isolation = 'executed'; this.timeline(active, '仅当前实验通道已隔离', 'action'); return structuredClone(active.run); }
  async stopInjection(runId: string): Promise<SecurityRun> { const active = this.require(runId); if (active.run.phase !== 'anomaly') return structuredClone(active.run); active.run.isolation = active.run.isolation === 'not_submitted' ? 'accepted' : active.run.isolation; this.timeline(active, '停止异常数据注入并清空待发送队列', 'action'); active.run.phase = 'recovery'; active.tick = 0; active.recovered = 0; active.recoveryStartedAt = Date.now(); active.recoveryMs = null; active.detector = { ...active.detector, lastSequence: null, lastConnection: null }; return structuredClone(active.run); }
  async verifyRecovery(runId: string): Promise<SecurityRun> { const active = this.require(runId); if (active.run.phase !== 'recovery') return structuredClone(active.run); if (active.recovered < 3) { active.run.error = '需要连续收到至少 3 条实时遥测后才能验证恢复'; return structuredClone(active.run); } if (active.run.isolation !== 'verified') { active.run.isolation = 'verified'; active.recoveryMs = active.recoveryStartedAt === null ? null : Date.now() - active.recoveryStartedAt; this.timeline(active, '实时遥测连续恢复，验证通过', 'recovery'); } return structuredClone(active.run); }
  async finish(runId: string, reflection: string): Promise<SecurityReport> { const active = this.require(runId); if (active.finalReport) return structuredClone(active.finalReport); active.reflection = reflection; active.run.phase = 'completed'; this.cleanup(active); this.timeline(active, '实验完成并保存报告', 'finish'); active.finalReport = this.report(active); this.history.push(active.finalReport); return structuredClone(active.finalReport); }
  async abort(runId: string): Promise<SecurityReport> { const active = this.require(runId); if (active.finalReport) return structuredClone(active.finalReport); active.run.phase = 'aborted'; this.cleanup(active); this.timeline(active, '实验中止并清理遥测订阅与队列', 'abort'); active.finalReport = this.report(active); this.history.push(active.finalReport); return structuredClone(active.finalReport); }
  subscribe(runId: string, onSample: SecurityTelemetryHandler, onEvidence: (items: SecurityEvidence[]) => void): () => void { const listeners = this.listeners.get(runId) ?? new Set(); const listener = { sample: onSample, evidence: onEvidence }; listeners.add(listener); this.listeners.set(runId, listeners); return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(runId); }; }
  private require(runId: string): ActiveRun { const active = this.runs.get(runId); if (!active) throw new Error('实验运行不存在'); return active; }
  private timeline(active: ActiveRun, label: string, kind: string): void { active.run.timeline.push({ at: Date.now(), label, kind }); }
  private schedule(active: ActiveRun): void { if (active.timer) return; active.timer = setInterval(() => this.emit(active), 1000); }
  private emit(active: ActiveRun): void {
    if (!['baseline', 'anomaly', 'recovery'].includes(active.run.phase)) return;
    active.tick += 1;
    const now = Date.now(); const anomalous = active.run.phase === 'anomaly' && active.run.isolation !== 'executed' && active.run.isolation !== 'verified'; const config = active.run.config;
    const interrupted = anomalous && active.actualCase === 'degradation' && config.difficulty === 'high' && active.tick % 7 === 0;
    const dropped = anomalous && active.actualCase === 'degradation' && config.difficulty !== 'low' && active.tick % 5 === 0;
    if (dropped) { this.addEvidence(active, { id: `${active.run.runId}-${now}-loss`, code: 'packet_loss', detail: '当前实验遥测通道观察到接收间隔扩大；丢失率仅按接收序列估算', receivedAt: now, automatic: true }); return; }
    const prev = active.run.telemetry;
    const receivedDelta = prev ? active.tick - prev.sequence : null;
    const live: SecurityTelemetry = { protocolVersion: 'security.telemetry.v1', runId: active.run.runId, source: 'simulation', sequence: active.tick, capturedAt: now, receivedAt: now, elapsedMs: active.tick * 1000, receiveIntervalMs: active.detector.lastReceivedAt === null ? null : now - active.detector.lastReceivedAt, missingRatePct: receivedDelta && receivedDelta > 0 ? (receivedDelta - 1) / receivedDelta * 100 : null, altitude: Math.sin(active.tick / 4) * 0.04, speed: Math.abs(Math.cos(active.tick / 5)) * 0.08, battery: Math.max(0, 100 - active.tick * 0.01), stale: false, connection: interrupted ? 'interrupted' : 'connected' };
    let sample = live;
    if (anomalous && active.actualCase === 'replay') {
      if (!active.replaySample && prev) active.replaySample = prev;
      if (active.replaySample) sample = { ...active.replaySample, receivedAt: now, elapsedMs: live.elapsedMs };
    }
    if (interrupted) { sample = { ...(prev ?? live), receivedAt: now, elapsedMs: live.elapsedMs, stale: true, connection: 'interrupted' }; }
    const evidence = detectSecurityEvidence(sample, active.detector);
    if (active.run.phase === 'recovery') active.recovered = !sample.stale && sample.connection === 'connected' && (!prev || sample.sequence > prev.sequence) ? active.recovered + 1 : 0;
    if (sample.sequence > (active.detector.lastSequence ?? -1)) active.detector.lastSequence = sample.sequence;
    active.detector.lastReceivedAt = now;
    active.detector.lastConnection = sample.connection;
    active.run.telemetry = sample;
    if (active.run.phase === 'baseline') active.baselineSequences.push(sample.sequence);
    if (evidence.length) this.addEvidence(active, ...evidence);
    this.listeners.get(active.run.runId)?.forEach((listener) => listener.sample(sample));
  }
  private addEvidence(active: ActiveRun, ...items: SecurityEvidence[]): void { active.run.evidence.push(...items); this.listeners.get(active.run.runId)?.forEach((listener) => listener.evidence(items)); }
  private cleanup(active: ActiveRun): void { if (active.timer) clearInterval(active.timer); active.timer = null; this.listeners.delete(active.run.runId); active.replaySample = null; }
  private report(active: ActiveRun): SecurityReport { const deductions: string[] = []; const expected = active.actualCase === 'replay' ? 'replay' : 'link_anomaly'; const right = active.run.judgment === expected; const falsePositives = active.run.judgments.filter((item) => item.falsePositive).length; if (!right) deductions.push('判断与实际异常不符或未提交（-30）'); if (falsePositives) deductions.push(`正常对照误报 ${falsePositives} 次（每次扣 5 分，最多扣 15 分）`); if (active.run.evidenceIds.length === 0) deductions.push('未提交支持判断的证据（-15）'); if (active.run.isolation !== 'verified') deductions.push('未完成隔离与恢复验证（-45）'); const sections = { judgmentEvidence: Math.max(0, (right && active.run.evidenceIds.length ? 30 : right ? 18 : 0) - Math.min(15, falsePositives * 5)), timeliness: right ? 15 : 0, handling: active.run.isolation !== 'not_submitted' ? 25 : 0, recovery: active.run.isolation === 'verified' ? 20 : 0, reflection: active.reflection.trim().length >= 20 ? 10 : 0 }; const score = { total: Object.values(sections).reduce((sum, item) => sum + item, 0), sections, deductions }; return { runId: active.run.runId, config: { ...active.run.config, caseId: active.actualCase }, caseVersion: active.run.caseVersion, scoreVersion: 'security-score-v1', seed: active.seed, phase: active.run.phase, timeline: structuredClone(active.run.timeline), evidence: structuredClone(active.run.evidence), judgment: active.run.judgment, judgments: structuredClone(active.run.judgments), isolation: active.run.isolation, reflection: active.reflection, recoveryMs: active.recoveryMs, score, scoreSource: 'mock', limitations: ['模拟成绩，不代表真实飞控防御或真实网络攻击阻断效果'] }; }
}
