import { Activity, CheckCircle2, Clock3, Users } from 'lucide-react';

import type { TaskGroup } from '../../../types/collaboration';
import styles from '../Collaboration.module.css';

const statusLabels = { WAITING: '等待执行', RUNNING: '协同执行中', COMPLETE: '已完成', FAILED: '异常' } as const;

export function ProgressPanel({ groups, elapsedSeconds, running }: { groups: TaskGroup[]; elapsedSeconds: number; running: boolean }) {
  const completed = groups.filter((group) => group.status === 'COMPLETE').length;
  return <div className={styles.progressPanel}><div className={styles.progressPanelHeader}><div><span className={styles.sectionEyebrow}><Activity size={15} />协同执行总览</span><strong>{completed}/5 任务完成</strong></div><span className={running ? styles.liveBadge : styles.pausedBadge}>{running ? '● LIVE' : '● PAUSED'}</span></div><div className={styles.progressSummary}><div><Clock3 size={15} /><small>执行时间</small><b>{String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:{String(elapsedSeconds % 60).padStart(2, '0')}</b></div><div><Users size={15} /><small>参与无人机</small><b>15</b></div><div><CheckCircle2 size={15} /><small>整体进度</small><b>{Math.round(groups.reduce((sum, group) => sum + group.progress, 0) / groups.length)}%</b></div></div><div className={styles.groupProgressList}>{groups.map((group) => <div className={styles.groupProgress} key={group.id}><div><span style={{ color: group.color }}>{group.name}</span><b>{Math.round(group.progress)}%</b></div><span className={styles.progressTrack}><i style={{ width: `${group.progress}%`, background: group.color }} /></span><small>{statusLabels[group.status]} · {group.drones.length} 架</small></div>)}</div></div>;
}
