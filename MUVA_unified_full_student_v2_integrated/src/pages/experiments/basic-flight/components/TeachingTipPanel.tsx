import { CircleAlert, Lightbulb } from 'lucide-react';

import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { useTelemetryStore } from '../../../../stores/telemetryStore';
import { useTrainingStore } from '../../../../stores/trainingStore';
import styles from './Panels.module.css';

export function TeachingTipPanel() {
  const tasks = useTrainingStore((state) => state.tasks);
  const hoverSeconds = useTrainingStore((state) => state.hoverSeconds);
  const latest = useTelemetryStore((state) => state.latest);
  const task = tasks.find((item) => item.status === 'ACTIVE');
  return (
    <PanelShell title="当前任务指导" icon={Lightbulb} emphasis="tertiary">
      <div className={styles.teachingTip}>
        <div className={styles.tipIcon}><CircleAlert size={22} /></div>
        <div className={styles.teachingContent}>
          <strong>{task?.title ?? '等待训练开始'}</strong>
          <div className={styles.teachingMetrics}>
            <span><small>训练目标</small><b>{task?.goal ?? '完成环境准备'}</b></span>
            <span><small>当前高度</small><b>{latest ? `${latest.position.altitude.toFixed(1)} m` : '--'}</b></span>
            <span><small>任务进度</small><b>{task ? `${Math.round(task.progress)}%` : '--'}</b></span>
            <span><small>{task?.id === 2 ? '已经稳定' : '当前速度'}</small><b>{task?.id === 2 ? `${hoverSeconds.toFixed(1)} s` : latest ? `${(latest.groundSpeed ?? latest.speedMetersPerSecond).toFixed(1)} m/s` : '--'}</b></span>
          </div>
          <div className={styles.completionRule}><small>完成条件</small><span>{task?.completionCondition ?? '完成环境准备后开始训练。'}</span></div>
          <p>保持姿态稳定，按任务顺序操作，避免连续快速发送指令。</p>
          {task ? <progress max={100} value={task.progress} aria-label="当前任务进度" /> : null}
        </div>
      </div>
    </PanelShell>
  );
}
