import { Check, Circle, ListChecks, LoaderCircle } from 'lucide-react';

import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { useTrainingStore } from '../../../../stores/trainingStore';
import { useFlightStore } from '../../../../stores/flightStore';
import styles from './Panels.module.css';

export function TrainingTaskPanel() {
  const tasks = useTrainingStore((state) => state.tasks);
  const activeTask = tasks.find((task) => task.status === 'ACTIVE');
  const flight = useFlightStore((state) => state.status);

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
      {activeTask?.id === 9 ? <p className={styles.taskHint}>RTL 只负责返航至 Home；到达 Home 后，请确认区域安全，再点击 LAND 执行安全降落。</p> : null}
      {activeTask?.id === 10 ? <p className={styles.taskHint}>已返航至 Home。当前任务是安全降落，请点击 LAND，并在确认窗口中确认；不需要点击“下降”按钮。</p> : null}
      {activeTask?.id === 10 && flight.armed && flight.position.altitude > 0.2 ? <p className={styles.taskHint}>当前高度 {flight.position.altitude.toFixed(1)} m · 等待 LAND 指令</p> : null}
    </PanelShell>
  );
}
