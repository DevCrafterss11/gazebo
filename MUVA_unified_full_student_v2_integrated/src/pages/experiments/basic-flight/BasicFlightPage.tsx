import { useEffect } from 'react';

import { useExperimentStore } from '../../../stores/experimentStore';
import { BasicFlightTrainingStep } from './steps/BasicFlightTrainingStep';
import { ParameterConfigurationStep } from './steps/ParameterConfigurationStep';
import { TrainingSceneStep } from './steps/TrainingSceneStep';
import { FlightReadinessStep } from './steps/FlightReadinessStep';
import { SystemCognitionStep } from './steps/SystemCognitionStep';
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
    return <SystemCognitionStep />;
  }

  if (currentStep === 2) {
    return <ParameterConfigurationStep />;
  }

  if (currentStep === 3) {
    return <TrainingSceneStep />;
  }

  if (currentStep === 5 || currentStep === 6) {
    return <FlightReadinessStep stepId={currentStep} />;
  }

  if (currentStep === 4) {
    return <SetupStep stepId={currentStep} />;
  }

  if (currentStep === 8) {
    return <ResultStep />;
  }

  return <BasicFlightTrainingStep />;
}
