import { Check, Circle, ListChecks, LoaderCircle } from 'lucide-react';

import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { useTrainingStore } from '../../../../stores/trainingStore';
import styles from './Panels.module.css';

export function TrainingTaskPanel() {
  const tasks = useTrainingStore((state) => state.tasks);

  return (
    <PanelShell title="当前训练任务" icon={ListChecks} action={<span>基础飞行训练</span>} emphasis="primary">
      <div className={styles.taskList}>
        {tasks.map((task) => (
          <div className={`${styles.taskRow} ${styles[task.status]}`} key={task.id}>
            <span className={styles.taskIndex}>{task.id}</span>
            <div className={styles.taskText}>
              <strong>{task.title}</strong>
            </div>
            <span className={styles.taskState}>
              {task.status === 'COMPLETED' ? (
                <Check size={17} />
              ) : task.status === 'ACTIVE' ? (
                <LoaderCircle size={17} />
              ) : (
                <Circle size={15} />
              )}
            </span>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}
