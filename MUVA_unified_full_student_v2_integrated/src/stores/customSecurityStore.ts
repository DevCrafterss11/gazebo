import { create } from 'zustand';
import { services } from '../services/serviceRegistry';
import { parseConfigJson, validateConfig } from '../domain/customSecurity/config';
import type { CustomSecurityConfig, CustomSecurityReport, CustomSecurityRun, RuleEvidence, ValidationIssue } from '../types/customSecurity';

export interface CustomSecurityState {
  step: number;
  config: CustomSecurityConfig;
  issues: ValidationIssue[];
  selectedEventId: string;
  selectedEvidence: string[];
  run: CustomSecurityRun | null;
  report: CustomSecurityReport | null;
  history: CustomSecurityReport[];
  reflection: string;
  error: string | null;
  busy: boolean;
  reportOpen: boolean;
  setStep: (step: number) => void;
  setConfig: (config: CustomSecurityConfig) => void;
  selectEvent: (eventId: string) => void;
  setEvidence: (evidenceIds: string[]) => void;
  setReflection: (reflection: string) => void;
  runScenario: () => Promise<void>;
  finish: () => Promise<void>;
  abort: () => Promise<void>;
  openReport: () => void;
  closeReport: () => void;
  clear: () => void;
  importConfig: (json: string) => void;
}

function cloneConfig(config: CustomSecurityConfig): CustomSecurityConfig { return structuredClone(config); }

export function createCustomSecurityStore(initialConfig: CustomSecurityConfig) {
  return create<CustomSecurityState>((set, get) => ({
    step: 0, config: initialConfig, issues: validateConfig(initialConfig), selectedEventId: initialConfig.scenario.events[0]?.id ?? '', selectedEvidence: [], run: null, report: null, history: [], reflection: '', error: null, busy: false, reportOpen: false,
    setStep: (step) => set({ step: Math.max(0, Math.min(5, step)), error: null }),
    setConfig: (config) => {
      const current = get().config;
      const next = cloneConfig(config);
      if (current.scenario.id === next.scenario.id && JSON.stringify(current.scenario) !== JSON.stringify(next.scenario) && current.scenario.version === next.scenario.version) next.scenario.version += 1;
      if (current.strategy.id === next.strategy.id && JSON.stringify(current.strategy) !== JSON.stringify(next.strategy) && current.strategy.version === next.strategy.version) next.strategy.version += 1;
      set({ config: next, issues: validateConfig(next), error: null });
    },
    selectEvent: (selectedEventId) => set({ selectedEventId }),
    setEvidence: (selectedEvidence) => set({ selectedEvidence: [...new Set(selectedEvidence)] }),
    setReflection: (reflection) => set({ reflection }),
    runScenario: async () => {
      const state = get();
      if (state.busy || state.run?.status === 'running') return;
      const issues = validateConfig(state.config);
      if (issues.length) { set({ issues, error: '配置尚未通过校验，请先修正标记字段' }); return; }
      set({ busy: true, error: null, report: null, reportOpen: false, selectedEvidence: [] });
      try {
        const run = await services.customSecurity.createRun(state.config, (nextRun) => set({ run: nextRun }));
        set({ run, step: 4 });
      } catch (error: unknown) { set({ error: error instanceof Error ? error.message : '无法启动自定义安全实验' }); }
      finally { set({ busy: false }); }
    },
    finish: async () => {
      const state = get();
      if (!state.run || state.busy || state.run.status !== 'completed') return;
      set({ busy: true, error: null });
      try {
        const report = await services.customSecurity.finish(state.run.runId, state.reflection, state.selectedEvidence);
        set({ report, history: [report, ...get().history], step: 5, reportOpen: true });
      } catch (error: unknown) { set({ error: error instanceof Error ? error.message : '无法生成自定义实验报告' }); }
      finally { set({ busy: false }); }
    },
    abort: async () => {
      const state = get();
      if (!state.run || state.busy || state.run.status !== 'running') return;
      set({ busy: true, error: null });
      try {
        const report = await services.customSecurity.abort(state.run.runId, state.reflection);
        set({ report, run: { ...get().run!, status: 'aborted' }, history: [report, ...get().history], step: 5, reportOpen: true });
      } catch (error: unknown) { set({ error: error instanceof Error ? error.message : '无法中止自定义实验' }); }
      finally { set({ busy: false }); }
    },
    openReport: () => set({ reportOpen: true }),
    closeReport: () => set({ reportOpen: false }),
    clear: () => set({ run: null, report: null, error: null, reflection: '', selectedEvidence: [], step: 0, reportOpen: false }),
    importConfig: (json) => {
      try { const config = parseConfigJson(json); set({ config, issues: [], selectedEventId: config.scenario.events[0]?.id ?? '', error: null }); }
      catch (error: unknown) { set({ error: error instanceof Error ? error.message : '配置文件无效' }); }
    },
  }));
}

import { createTemplate } from '../domain/customSecurity/config';
export const useCustomSecurityStore = createCustomSecurityStore(createTemplate());

export function selectedEvidenceDetails(report: CustomSecurityReport | null, selected: string[]): RuleEvidence[] {
  if (!report) return [];
  const selectedSet = new Set(selected.length > 0 ? selected : report.selectedEvidence);
  return report.result.evidence.filter((item) => selectedSet.has(item.id));
}
