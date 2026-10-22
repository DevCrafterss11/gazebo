import type { CustomSecurityService, CustomSecurityRunHandler } from '../contracts';
import { fixedAssessmentConfig, validateConfig } from '../../domain/customSecurity/config';
import { runCustomSecurityEngine } from '../../domain/customSecurity/engine';
import type { CustomEngineResult, CustomSecurityConfig, CustomSecurityReport, CustomSecurityRun, RuleEvidence } from '../../types/customSecurity';

interface ActiveRun {
  config: CustomSecurityConfig;
  result: CustomEngineResult;
  run: CustomSecurityRun;
  report: CustomSecurityReport | null;
  timer: ReturnType<typeof setInterval> | null;
  startedAt: number;
  cursor: number;
  onUpdate: CustomSecurityRunHandler;
}

function scoreReport(result: CustomEngineResult, config: CustomSecurityConfig, selectedEvidence: string[]): { total: number; sections: Record<string, number>; passed: boolean; deductions: string[] } | null {
  if (config.mode !== 'assessment') return null;
  const deductions: string[] = [];
  const detectionRates = [result.observations.length ? result.observations.filter((item) => item.truthAnomalous && item.detected).length / Math.max(1, result.observations.filter((item) => item.truthAnomalous).length) : 0, result.truth.events.filter((event) => event.type === 'loss' || event.type === 'interruption').length === 0 ? 0 : result.recovery.length > 0 ? result.recovery.filter((item) => item.recoveredAtMs !== null).length / result.recovery.length : 0];
  const detection = Math.round(30 * ((detectionRates[0] ?? 0) * 0.7 + (detectionRates[1] ?? 0) * 0.3));
  const falsePositiveRate = result.observations.length === 0 ? 1 : result.observations.filter((item) => !item.truthAnomalous && item.detected).length / Math.max(1, result.observations.filter((item) => !item.truthAnomalous).length);
  const falseAlarm = Math.max(0, Math.round(20 * (1 - falsePositiveRate)));
  const retention = result.observations.length === 0 ? 0 : result.observations.filter((item) => !item.truthAnomalous && item.accepted).length / Math.max(1, result.observations.filter((item) => !item.truthAnomalous).length);
  const anomalyAcceptance = result.observations.filter((item) => item.truthAnomalous && item.accepted).length / Math.max(1, result.observations.filter((item) => item.truthAnomalous).length);
  const availability = Math.max(0, Math.min(1, retention * (1 - anomalyAcceptance)));
  const recoveryRate = result.recovery.length === 0 ? 0 : result.recovery.filter((item) => item.recoveredAtMs !== null).length / result.recovery.length;
  const validEvidence = new Set(result.evidence.map((item) => item.id));
  const evidenceRate = result.evidence.length === 0 ? 0 : selectedEvidence.filter((id) => validEvidence.has(id)).length / result.evidence.length;
  const sections = { 异常识别: detection, 误报控制: falseAlarm, 数据可用性: Math.round(20 * availability), 恢复验证: Math.round(20 * recoveryRate), 证据选择: Math.min(10, Math.round(10 * evidenceRate)) };
  if (sections['异常识别'] < 18) deductions.push('异常识别证据不足');
  if (sections['误报控制'] < 14) deductions.push('正常数据误报较多');
  if (sections['数据可用性'] < 12) deductions.push('数据保留与异常过滤未同时满足可用性约束');
  if (sections['恢复验证'] < 14) deductions.push('未在恢复条件下稳定接收新鲜连续数据');
  if (sections['证据选择'] < 6) deductions.push('选择的证据不能覆盖可定位的检测样本');
  const total = Object.values(sections).reduce((sum, value) => sum + value, 0);
  return { total, sections, passed: total >= 60 && sections['数据可用性'] >= 8, deductions };
}

export class MockCustomSecurityService implements CustomSecurityService {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly reports: CustomSecurityReport[] = [];

  async createRun(draft: CustomSecurityConfig, onUpdate: CustomSecurityRunHandler): Promise<CustomSecurityRun> {
    const issues = validateConfig(draft);
    if (issues.length) throw new Error(issues.map((issue) => `${issue.field}: ${issue.message}`).join('；'));
    const config = draft.mode === 'assessment' ? fixedAssessmentConfig(draft) : structuredClone(draft);
    const fixedIssues = validateConfig(config);
    if (fixedIssues.length) throw new Error(fixedIssues.map((issue) => `${issue.field}: ${issue.message}`).join('；'));
    const runId = crypto.randomUUID();
    const result = runCustomSecurityEngine(config, runId);
    const run: CustomSecurityRun = { runId, status: 'running', mode: config.mode, elapsedMs: 0, durationMs: result.durationMs, playbackRate: 20, datasetId: result.datasetId, inputDigest: result.inputDigest, observations: [], evidence: [], acceptedCount: 0, truth: config.mode === 'training' ? result.truth : null, error: null };
    const active: ActiveRun = { config, result, run, report: null, timer: null, startedAt: Date.now(), cursor: 0, onUpdate };
    this.runs.set(runId, active);
    active.timer = setInterval(() => this.tick(active), 25);
    onUpdate(structuredClone(run));
    return structuredClone(run);
  }

  async finish(runId: string, reflection: string, selectedEvidence: string[]): Promise<CustomSecurityReport> {
    const active = this.require(runId);
    if (active.report) return structuredClone(active.report);
    if (active.run.status !== 'completed') throw new Error('运行尚未完成，不能结算；请等待时间轴走完或选择停止运行');
    active.report = this.createReport(active, 'completed', reflection, selectedEvidence);
    this.reports.unshift(active.report);
    return structuredClone(active.report);
  }

  async abort(runId: string, reflection: string): Promise<CustomSecurityReport> {
    const active = this.require(runId);
    if (active.report) return structuredClone(active.report);
    this.stopTimer(active);
    active.run.status = 'aborted';
    active.onUpdate(structuredClone(active.run));
    active.report = this.createReport(active, 'student-stop', reflection, []);
    this.reports.unshift(active.report);
    return structuredClone(active.report);
  }

  async listReports(): Promise<CustomSecurityReport[]> { return structuredClone(this.reports); }
  async getRun(runId: string): Promise<CustomSecurityRun | null> { const active = this.runs.get(runId); return active ? structuredClone(active.run) : null; }
  async validateEvidence(runId: string, evidenceIds: string[]): Promise<RuleEvidence[]> { const active = this.require(runId); const selected = new Set(evidenceIds); return structuredClone(active.result.evidence.filter((item) => selected.has(item.id))); }

  private tick(active: ActiveRun): void {
    if (active.run.status !== 'running') return;
    const virtualElapsed = Math.min(active.result.durationMs + 5000, (Date.now() - active.startedAt) * active.run.playbackRate);
    active.run.elapsedMs = Math.min(active.result.durationMs, virtualElapsed);
    while (active.cursor < active.result.observations.length && active.result.observations[active.cursor]!.frame.receivedAtMs <= virtualElapsed) active.cursor += 1;
    active.run.observations = active.result.observations.slice(0, active.cursor);
    active.run.evidence = active.result.evidence.filter((item) => item.atMs <= virtualElapsed);
    active.run.acceptedCount = active.run.observations.filter((item) => item.accepted).length;
    active.onUpdate(structuredClone(active.run));
    if (virtualElapsed >= active.result.durationMs + 2500) {
      this.stopTimer(active);
      active.run.elapsedMs = active.result.durationMs;
      active.run.status = 'completed';
      active.run.observations = active.result.observations.slice();
      active.run.evidence = active.result.evidence.slice();
      active.run.acceptedCount = active.result.acceptedIds.length;
      active.onUpdate(structuredClone(active.run));
    }
  }

  private createReport(active: ActiveRun, reason: 'completed' | 'student-stop', reflection: string, selectedEvidence: string[]): CustomSecurityReport {
    const endedAt = new Date().toISOString();
    const validEvidence = active.result.evidence.filter((item) => selectedEvidence.includes(item.id)).map((item) => item.id);
    const result = reason === 'completed' ? active.result : this.partialResult(active);
    return { schemaVersion: 'custom-security-report.v1', runId: active.run.runId, engineVersion: result.engineVersion, scoreVersion: 'custom-security-score.v1', datasetId: result.datasetId, datasetDigest: result.datasetDigest, inputDigest: result.inputDigest, config: structuredClone(active.config), startedAt: new Date(active.startedAt).toISOString(), endedAt, endReason: reason, status: reason === 'completed' ? 'completed' : 'aborted', metrics: this.metrics(result), score: reason === 'completed' ? scoreReport(result, active.config, selectedEvidence) : null, label: active.config.mode === 'assessment' ? '本地模拟练习成绩（固定测试集）' : '本地模拟练习报告（探索验证）', selectedEvidence: [...selectedEvidence], validEvidence, reflection, result: structuredClone(result) };
  }

  private partialResult(active: ActiveRun): CustomEngineResult {
    const observations = active.result.observations.slice(0, active.cursor);
    const ids = new Set(observations.map((item) => item.frame.frameId));
    const evidence = active.result.evidence.filter((item) => item.atMs <= active.run.elapsedMs && (item.observationId === null || ids.has(item.observationId)));
    const truth = { ...active.result.truth, observations: Object.fromEntries(Object.entries(active.result.truth.observations).filter(([id]) => ids.has(id))), events: active.result.truth.events.filter((event) => event.startSec * 1000 <= active.run.elapsedMs) };
    return { ...active.result, observations, evidence, acceptedIds: active.result.acceptedIds.filter((id) => ids.has(id)), controlIds: active.result.controlIds.filter((id) => ids.has(id)), inputIds: { control: active.result.inputIds.control.filter((id) => ids.has(id)), strategy: active.result.inputIds.strategy.filter((id) => ids.has(id)) }, truth, recovery: active.result.recovery.filter((item) => item.endMs <= active.run.elapsedMs), recoveryTransitions: active.result.recoveryTransitions.filter((value) => value <= active.run.elapsedMs) };
  }

  private metrics(result: CustomEngineResult): CustomSecurityReport['metrics'] {
    const observations = result.observations;
    const anomaly = observations.filter((item) => item.truthAnomalous);
    const normal = observations.filter((item) => !item.truthAnomalous);
    const rate = (numerator: number, denominator: number) => ({ numerator, denominator, rate: denominator === 0 ? null : numerator / denominator });
    const frameTp = anomaly.filter((item) => item.detected).length;
    const frameFp = normal.filter((item) => item.detected).length;
    return { frames: { tp: frameTp, fp: frameFp, fn: anomaly.length - frameTp, detection: rate(frameTp, anomaly.length), falsePositive: rate(frameFp, normal.length) }, windows: { ...result.truth.events.filter((event) => event.type === 'loss' || event.type === 'interruption').reduce((value, event) => value, { tp: 0, fn: 0, falseAlarms: 0, normalChecks: 0, falsePositive: rate(0, 0), detection: rate(0, 0), eventIds: [] as string[] }), eventIds: result.truth.events.filter((event) => event.type === 'loss' || event.type === 'interruption').map((event) => event.id) }, normalRetention: rate(normal.filter((item) => item.accepted).length, normal.length), anomalyAcceptance: rate(anomaly.filter((item) => item.accepted).length, anomaly.length), controlAnomalyAcceptance: rate(anomaly.length, anomaly.length), recovery: result.recovery.map((item) => ({ eventIds: item.eventIds, endMs: item.endMs, recoveredAtMs: item.recoveredAtMs, elapsedMs: item.elapsedMs })) };
  }

  private stopTimer(active: ActiveRun): void { if (active.timer) clearInterval(active.timer); active.timer = null; }
  private require(runId: string): ActiveRun { const active = this.runs.get(runId); if (!active) throw new Error('自定义安全实验运行不存在'); return active; }
}
