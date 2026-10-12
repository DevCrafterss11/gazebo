import { Outlet } from 'react-router-dom';

import { useExperimentStore } from '../../stores/experimentStore';
import { ExperimentHeader } from './ExperimentHeader';
import { ExperimentStepper } from './ExperimentStepper';
import styles from './ExperimentLayout.module.css';

export function ExperimentLayout() {
  const experiment = useExperimentStore((state) => state.experiment);
  const goToStep = useExperimentStore((state) => state.goToStep);
  const isExperimentActive = useExperimentStore((state) => state.isExperimentActive);

  return (
    <div className={`${styles.experimentLayout} ${!isExperimentActive ? styles.entryLayout : ''}`}>
      <ExperimentHeader
        title={experiment.title}
        subtitle={experiment.subtitle}
      />
      {isExperimentActive && <ExperimentStepper steps={experiment.steps} onStepSelect={goToStep} />}
      <div className={styles.experimentBody}>
        <Outlet />
      </div>
    </div>
  );
}
