import { useEffect } from 'react';

import { useExperimentStore } from '../../../stores/experimentStore';
import { BasicFlightTrainingStep } from './steps/BasicFlightTrainingStep';
import { DroneSelectionStep } from './steps/DroneSelectionStep';
import { ResultStep } from './steps/ResultStep';
import { SetupStep } from './steps/SetupStep';

export function BasicFlightPage() {
  const currentStep = useExperimentStore((state) => state.experiment.currentStep);
  const initialize = useExperimentStore((state) => state.initialize);
  const initializationError = useExperimentStore((state) => state.initializationError);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  if (initializationError) {
    return <section role="alert">{initializationError}</section>;
  }

  if (currentStep === 1) {
    return <DroneSelectionStep />;
  }

  if (currentStep >= 2 && currentStep <= 6) {
    return <SetupStep stepId={currentStep} />;
  }

  if (currentStep === 8) {
    return <ResultStep />;
  }

  return <BasicFlightTrainingStep />;
}
