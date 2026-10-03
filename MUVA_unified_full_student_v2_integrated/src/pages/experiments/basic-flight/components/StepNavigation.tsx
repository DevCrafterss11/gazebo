import { ArrowLeft, ArrowRight, Play } from 'lucide-react';

import styles from './WorkflowSteps.module.css';

interface StepNavigationProps {
  canGoBack: boolean;
  canGoNext?: boolean;
  isLaunchStep?: boolean;
  nextLabel?: string;
  onBack: () => void;
  onNext: () => void;
}

export function StepNavigation({
  canGoBack,
  canGoNext = true,
  isLaunchStep = false,
  nextLabel,
  onBack,
  onNext,
}: StepNavigationProps) {
  return (
    <div className={styles.navigationActions}>
      <button className={styles.backButton} type="button" disabled={!canGoBack} title={!canGoBack ? '当前已是第一步' : '返回上一步'} onClick={onBack}>
        <ArrowLeft size={16} />
        上一步
      </button>
      <button className={styles.nextButton} type="button" disabled={!canGoNext} title={!canGoNext ? '请先完成本步骤要求' : '保存并进入下一步'} onClick={onNext}>
        {isLaunchStep ? <Play size={17} /> : null}
        {nextLabel ?? (isLaunchStep ? '启动仿真训练' : '下一步')}
        {!isLaunchStep ? <ArrowRight size={17} /> : null}
      </button>
    </div>
  );
}
