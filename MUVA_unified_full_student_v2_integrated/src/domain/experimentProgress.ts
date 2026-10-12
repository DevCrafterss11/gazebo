import type { PersistedExperimentState } from '../services/contracts';

export const resumableExperimentProgress = (progress: PersistedExperimentState | null): PersistedExperimentState | null => {
  if (!progress || progress.version !== 2 || !Number.isInteger(progress.currentStep) || progress.currentStep < 1 || progress.currentStep > 8) return null;
  if (progress.session?.status === 'FINISHED' || progress.assessment?.finalizedAt) return null;
  if (progress.sessionId && progress.session?.id !== progress.sessionId) return null;
  if (!progress.progressId && !progress.sessionId) return null;
  return progress;
};
