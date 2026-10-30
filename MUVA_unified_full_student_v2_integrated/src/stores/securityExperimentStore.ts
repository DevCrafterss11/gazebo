import { create } from 'zustand';
import { services } from '../services/serviceRegistry';
import type { SecurityConfig, SecurityEvidence, SecurityJudgment, SecurityReport, SecurityRun, SecurityTelemetry } from '../types/securityExperiment';

const storageKey = 'muva-security-active-run-v1';
interface SecurityState {
  run: SecurityRun | null;
  report: SecurityReport | null;
  reflection: string;
  busy: boolean;
  unsubscribe: (() => void) | null;
  history: SecurityReport[];
  error: string | null;
  executeSimulationMotorStop: () => Promise<void>;
  executeWaypointTampering: (input: { waypoints: { latitude: number; longitude: number }[]; offsetSide: 'left' | 'right' }) => Promise<void>;
  create: (config: SecurityConfig) => Promise<void>;
  restore: () => Promise<void>;
  baseline: () => Promise<void>;
  anomaly: () => Promise<void>;
  judge: (judgment: SecurityJudgment, evidenceIds: string[]) => Promise<void>;
  isolate: () => Promise<void>;
  stop: () => Promise<void>;
  verify: () => Promise<void>;
  setReflection: (value: string) => void;
  finish: () => Promise<void>;
  abort: () => Promise<void>;
  clear: () => void;
  receive: (sample: SecurityTelemetry) => void;
  receiveEvidence: (items: SecurityEvidence[]) => void;
}

export const useSecurityExperimentStore = create<SecurityState>((set, get) => {
  const attach = (run: SecurityRun): void => {
    get().unsubscribe?.();
    const unsubscribe = services.security.subscribe(run.runId,
      (sample) => get().receive(sample),
      (evidence) => get().receiveEvidence(evidence));
    set({ unsubscribe, run, error: null });
  };
  const action = async (operation: (runId: string) => Promise<SecurityRun>): Promise<void> => {
    const run = get().run;
    if (!run || get().busy) return;
    set({ busy: true, error: null });
    try { attach(await operation(run.runId)); }
    catch (error: unknown) { set({ error: error instanceof Error ? error.message : '安全实验操作失败' }); }
    finally { set({ busy: false }); }
  };
  const finish = async (aborting: boolean): Promise<void> => {
    const run = get().run;
    if (!run || get().busy) return;
    set({ busy: true, error: null });
    try {
      const report = aborting ? await services.security.abort(run.runId) : await services.security.finish(run.runId, get().reflection);
      get().unsubscribe?.();
      localStorage.removeItem(storageKey);
      set({ report, run: { ...run, phase: aborting ? 'aborted' : 'completed' }, history: [report, ...get().history], unsubscribe: null });
    } catch (error: unknown) { set({ error: error instanceof Error ? error.message : '保存报告失败' }); }
    finally { set({ busy: false }); }
  };
  return {
    run: null, report: null, reflection: '', busy: false, unsubscribe: null, history: [], error: null,
    executeSimulationMotorStop: async () => {
      if (get().busy) return;
      set({ busy: true, error: null });
      try { await services.security.executeSimulationMotorStop(); }
      catch (error: unknown) { const message = error instanceof Error ? error.message : '攻击执行失败'; set({ error: message }); throw error; }
      finally { set({ busy: false }); }
    },
    executeWaypointTampering: async (input) => {
      if (get().busy) throw new Error('另一个安全实验操作正在执行');
      set({ busy: true, error: null });
      try { await services.security.executeWaypointTampering(input); }
      catch (error: unknown) { const message = error instanceof Error ? error.message : '航点篡改执行失败'; set({ error: message }); throw error; }
      finally { set({ busy: false }); }
    },
    create: async (config) => {
      if (get().busy || get().run) return;
      set({ busy: true, error: null, report: null });
      try { const run = await services.security.createRun(config); localStorage.setItem(storageKey, run.runId); attach(run); }
      catch (error: unknown) { set({ error: error instanceof Error ? error.message : '无法创建安全实验运行' }); }
      finally { set({ busy: false }); }
    },
    restore: async () => {
      try { set({ history: await services.security.listReports() }); }
      catch (error: unknown) { set({ error: error instanceof Error ? error.message : '无法读取安全实验历史' }); }
      const runId = localStorage.getItem(storageKey);
      if (!runId || get().run || get().busy) return;
      set({ busy: true });
      try {
        const restored = await services.security.getRun(runId);
        if (!restored || ['completed', 'aborted', 'failed'].includes(restored.phase)) {
          localStorage.removeItem(storageKey);
          set({ run: null, error: restored ? '上次运行已结束，请查看历史报告。' : '无法从服务端恢复上次运行；已标记为不可恢复，请重新开始。' });
          return;
        }
        if (restored.phase !== 'preparation') {
          await services.security.abort(runId);
          localStorage.removeItem(storageKey);
          set({ run: null, error: '检测到刷新或断线后的未完成运行，已中止并清理；请重新开始。' });
          return;
        }
        attach(restored);
      } catch (error: unknown) { localStorage.removeItem(storageKey); set({ run: null, error: error instanceof Error ? error.message : '运行状态不可用，不能恢复旧遥测' }); }
      finally { set({ busy: false }); }
    },
    baseline: () => action(services.security.startBaseline.bind(services.security)),
    anomaly: () => action(services.security.startAnomaly.bind(services.security)),
    judge: (judgment, evidenceIds) => action((id) => services.security.submitJudgment(id, judgment, evidenceIds, crypto.randomUUID())),
    isolate: () => action(services.security.isolate.bind(services.security)),
    stop: () => action(services.security.stopInjection.bind(services.security)),
    verify: () => action(services.security.verifyRecovery.bind(services.security)),
    setReflection: (reflection) => set({ reflection }),
    finish: () => finish(false),
    abort: () => finish(true),
    clear: () => { get().unsubscribe?.(); localStorage.removeItem(storageKey); set({ run: null, report: null, reflection: '', error: null, unsubscribe: null }); },
    receive: (telemetry) => { const run = get().run; if (run?.runId === telemetry.runId) set({ run: { ...run, telemetry, error: undefined } }); },
    receiveEvidence: (items) => { const run = get().run; if (run) set({ run: { ...run, evidence: [...run.evidence, ...items.filter((item) => !run.evidence.some((existing) => existing.id === item.id))] } }); },
  };
});
