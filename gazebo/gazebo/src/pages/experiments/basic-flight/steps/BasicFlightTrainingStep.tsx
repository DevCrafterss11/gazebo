import { useEffect } from 'react';

import { useExperimentStore } from '../../../../stores/experimentStore';
import { useTelemetryStore } from '../../../../stores/telemetryStore';
import { useTrainingStore } from '../../../../stores/trainingStore';
import { FlightControlPanel } from '../components/FlightControlPanel';
import { FlightStatusPanel } from '../components/FlightStatusPanel';
import { FlightViewPanel } from '../components/FlightViewPanel';
import { TeachingTipPanel } from '../components/TeachingTipPanel';
import { TelemetryCharts } from '../components/TelemetryCharts';
import { TrainingScorePanel } from '../components/TrainingScorePanel';
import { TrainingTaskPanel } from '../components/TrainingTaskPanel';
import styles from '../BasicFlightPage.module.css';

export function BasicFlightTrainingStep() {
  const configuration = useExperimentStore((state) => state.configuration);
  const selectedDrone = useExperimentStore((state) => state.selectedDrone);
  const selectedScene = useExperimentStore((state) => state.selectedScene);
  const sessionId = useExperimentStore((state) => state.sessionId);
  const completeExperiment = useExperimentStore((state) => state.completeExperiment);
  const initializeTraining = useTrainingStore((state) => state.initialize);
  const connectTelemetry = useTelemetryStore((state) => state.connect);

  useEffect(() => {
    if (!selectedDrone || !selectedScene || !sessionId) return;
    initializeTraining(
      configuration.flightParameters,
      { latitude: selectedScene.latitude, longitude: selectedScene.longitude },
      selectedDrone.name,
      selectedScene.name,
      (result) => { void completeExperiment(result); },
    );
    connectTelemetry();
  }, [completeExperiment, configuration.flightParameters, connectTelemetry, initializeTraining, selectedDrone, selectedScene, sessionId]);

  return (
    <div className={styles.page}>
      <div className={styles.leftColumn}>
        <TrainingTaskPanel />
        <TeachingTipPanel />
      </div>
      <div className={styles.centerColumn}>
        <FlightViewPanel />
        <FlightControlPanel />
      </div>
      <div className={styles.rightColumn}>
        <FlightStatusPanel />
        <TrainingScorePanel />
      </div>
      <div className={styles.telemetryRow}>
        <TelemetryCharts />
      </div>
    </div>
  );
}
