import { CheckCircle2, Clock3, RadioTower } from 'lucide-react';

import type { Task } from '../../../types/collaboration';
import styles from '../Collaboration.module.css';

const statusLabels = { WAITING: '等待执行', RUNNING: '执行中', COMPLETE: '已完成', FAILED: '需处理' } as const;

export function TaskCard({ task, active, onClick }: { task: Task; active?: boolean; onClick?: () => void }) {
  const Icon = task.status === 'COMPLETE' ? CheckCircle2 : task.status === 'RUNNING' ? RadioTower : Clock3;
  return <button className={`${styles.taskCard} ${active ? styles.taskCardActive : ''}`} style={{ '--task-color': task.color } as React.CSSProperties} onClick={onClick} type="button">
    <span className={styles.taskIcon}><Icon size={17} /></span>
    <span className={styles.taskCardCopy}><strong>{task.name}</strong><small>{task.area} · {task.type}</small></span>
    <span className={styles.taskCardMeta}><b>{task.droneCount} UAV</b><small>{statusLabels[task.status]}</small></span>
  </button>;
}
