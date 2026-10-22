import { ChevronRight, Layers3 } from 'lucide-react';

import type { Task, TaskGroup } from '../../../types/collaboration';
import styles from '../Collaboration.module.css';

const statusLabels = { WAITING: '待配置', RUNNING: '执行中', COMPLETE: '已完成', FAILED: '异常' } as const;

export function TaskGroupTree({ groups, selectedId, onSelect, tasks }: { groups: TaskGroup[]; selectedId: string; onSelect: (id: string) => void; tasks?: Task[] }) {
  return <div className={styles.groupTree}>
    <div className={styles.sectionEyebrow}><Layers3 size={15} />{tasks ? '独立任务 / 无人机编组' : '任务组结构'}</div>
    {groups.map((group) => <button className={`${styles.groupTreeItem} ${selectedId === group.id ? styles.groupTreeItemActive : ''}`} key={group.id} style={{ '--group-color': group.color } as React.CSSProperties} onClick={() => onSelect(group.id)} type="button">
      <span className={styles.groupDot} /><span><strong>{tasks?.find((task) => task.id === group.taskId)?.name ?? group.name}</strong><small>{group.drones.length} 架 · {statusLabels[group.status]}</small></span><b>{Math.round(group.progress)}%</b><ChevronRight size={15} />
    </button>)}
  </div>;
}
