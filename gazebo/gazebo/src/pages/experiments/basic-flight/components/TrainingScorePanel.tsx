import { Check, CircleAlert, Trophy } from 'lucide-react';

import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { useFlightStore } from '../../../../stores/flightStore';
import { useTrainingStore } from '../../../../stores/trainingStore';
import styles from './Panels.module.css';

export function TrainingScorePanel() {
  const tasks = useTrainingStore((state) => state.tasks);
  const averageAltitudeError = useTrainingStore((state) => state.averageAltitudeError);
  const safetyEvents = useTrainingStore((state) => state.safetyEvents);
  const operationErrors = useFlightStore((state) => state.operationErrors);
  const completedTasks = tasks.filter((task) => task.status === 'COMPLETED').length;
  const progressPercent = Math.round((completedTasks / tasks.length) * 100);
  const currentScore = Math.max(0, Math.round(100 - averageAltitudeError * 8 - safetyEvents.length * 5));
  const feedback = [
    { label: '飞行稳定性', value: averageAltitudeError < 0.5 ? '良好' : `误差 ${averageAltitudeError.toFixed(1)}m`, healthy: averageAltitudeError < 0.5 },
    { label: '安全操作', value: operationErrors === 0 && safetyEvents.length === 0 ? '良好' : `${operationErrors + safetyEvents.length} 次事件`, healthy: operationErrors === 0 && safetyEvents.length === 0 },
    { label: '任务效率', value: `${completedTasks}/${tasks.length}`, healthy: completedTasks === tasks.length },
  ];

  return (
    <PanelShell title="训练评分" icon={Trophy} emphasis="tertiary">
      <div className={styles.scoreContent}>
        <div className={styles.scoreSummary}>
          <div className={styles.scoreDial}>
            <strong>{currentScore}</strong>
            <span>/ 100</span>
          </div>
          <div className={styles.scoreNumbers}>
            <div><span>完成进度</span><strong>{progressPercent}%</strong></div>
            <div><span>任务完成</span><strong>{completedTasks}/{tasks.length}</strong></div>
          </div>
        </div>
        <progress className={styles.progressTrack} max={100} value={progressPercent} />
        <div className={styles.feedbackList}>
          {feedback.map((item) => (
            <div className={item.healthy ? '' : styles.feedbackPending} key={item.label}>
              {item.healthy ? <Check size={13} /> : <CircleAlert size={13} />}
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>
    </PanelShell>
  );
}
