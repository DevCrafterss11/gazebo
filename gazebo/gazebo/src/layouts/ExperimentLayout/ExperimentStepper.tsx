import { Check } from 'lucide-react';

import type { ExperimentStep } from '../../types/experiment';
import styles from './ExperimentLayout.module.css';

interface ExperimentStepperProps {
  steps: ExperimentStep[];
  onStepSelect: (stepId: number) => void;
}

export function ExperimentStepper({ steps, onStepSelect }: ExperimentStepperProps) {
  return (
    <nav className={styles.stepper} aria-label="实验步骤">
      {steps.map((step) => (
        <button
          type="button"
          className={`${styles.step} ${styles[step.status]}`}
          key={step.id}
          aria-current={step.status === 'active' ? 'step' : undefined}
          disabled={step.status !== 'completed'}
          title={step.status === 'pending' ? '请先完成前置步骤' : step.status === 'completed' ? `返回“${step.title}”` : `当前步骤：${step.title}`}
          onClick={() => onStepSelect(step.id)}
        >
          <span className={styles.stepNumber}>
            {step.status === 'completed' ? <Check size={16} /> : step.id}
          </span>
          <span className={styles.stepTitle}>{step.title}</span>
          {step.id < steps.length ? <span className={styles.stepConnector} /> : null}
        </button>
      ))}
    </nav>
  );
}
