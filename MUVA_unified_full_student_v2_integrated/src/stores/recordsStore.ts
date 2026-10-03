import { create } from 'zustand';

import { services } from '../services/serviceRegistry';
import type { ExperimentRecord } from '../types/record';

interface RecordsState {
  records: ExperimentRecord[];
  currentRecord: ExperimentRecord | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadRecord: (recordId: string) => Promise<void>;
}

export const useRecordsStore = create<RecordsState>((set) => ({
  records: [],
  currentRecord: null,
  isLoading: false,
  error: null,
  refresh: async () => {
    set({ isLoading: true, error: null });
    try {
      const records = await services.experiments.listRecords();
      set({ records, isLoading: false });
    } catch (error: unknown) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : '实验记录加载失败',
      });
    }
  },
  loadRecord: async (recordId) => {
    set({ isLoading: true, error: null, currentRecord: null });
    try {
      const currentRecord = await services.experiments.getRecord(recordId);
      set({ currentRecord, isLoading: false });
    } catch (error: unknown) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : '实验记录详情加载失败',
      });
    }
  },
}));
