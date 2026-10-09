import { useEffect } from 'react';

import { useExperimentStore } from '../../../../stores/experimentStore';
import { useTelemetryStore } from '../../../../stores/telemetryStore';
import { useTrainingStore } from '../../../../stores/trainingStore';
import { FlightControlPanel } from '../components/FlightControlPanel';
import { FlightStatusPanel } from '../components/FlightStatusPanel';
import { FlightViewPanel } from '../components/FlightViewPanel';
import { CustomRouteButton } from '../components/CustomRouteButton';
import { TeachingTipPanel } from '../components/TeachingTipPanel';
import { TelemetryCharts } from '../components/TelemetryCharts';
import { TrainingScorePanel } from '../components/TrainingScorePanel';
import { TrainingTaskPanel } from '../components/TrainingTaskPanel';
import styles from '../BasicFlightPage.module.css';

export function BasicFlightTrainingStep() {
  const configuration = useExperimentStore((state) => state.configuration);
  const selectedDrone = useExperimentStore((state) => state.selectedDrone);
  const selectedScene = useExperimentStore((state) => state.selectedScene);
  const completeExperiment = useExperimentStore((state) => state.completeExperiment);
  const initializeTraining = useTrainingStore((state) => state.initialize);
  const trainingResult = useTrainingStore((state) => state.result);
  const connectTelemetry = useTelemetryStore((state) => state.connect);

  useEffect(() => {
    connectTelemetry();
    // sessionId is an in-memory runtime value and is intentionally not part
    // of the persisted configuration. After a page refresh, the experiment
    // can still resume from its saved step and must keep processing telemetry.
    if (!selectedDrone || !selectedScene || !configuration.homePosition) return;
    initializeTraining(
      configuration.flightParameters,
      { latitude: configuration.homePosition.latitude, longitude: configuration.homePosition.longitude },
      selectedDrone.name,
      selectedScene.name,
      // Keep the training page open after all basic tasks are complete. The
      // user can run a custom route before explicitly opening the result.
      () => {},
    );
  }, [configuration.flightParameters, configuration.homePosition, connectTelemetry, initializeTraining, selectedDrone, selectedScene]);

  return (
    <div className={styles.page}>
      <div className={styles.leftColumn}>
        <TrainingTaskPanel />
        <CustomRouteButton />
        <TeachingTipPanel />
      </div>
      <div className={styles.centerColumn}>
        <FlightViewPanel />
        <FlightControlPanel />
      </div>
      <div className={styles.rightColumn}>
        <FlightStatusPanel />
        <TrainingScorePanel
          onViewResult={trainingResult ? () => { void completeExperiment(trainingResult); } : undefined}
        />
      </div>
      <div className={styles.telemetryRow}>
        <TelemetryCharts />
      </div>
    </div>
  );
}
