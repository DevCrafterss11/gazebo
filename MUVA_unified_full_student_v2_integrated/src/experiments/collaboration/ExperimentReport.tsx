import { CheckCircle2, Clock3, Download, Flag, Users } from 'lucide-react';

import { useCollaborationStore } from '../../stores/collaborationStore';
import { ScoreCard } from './components/ScoreCard';
import styles from './Collaboration.module.css';

export function ExperimentReport() {
  const score = useCollaborationStore((state) => state.score);
  const reset = useCollaborationStore((state) => state.reset);
  return <div className={styles.stepPage}><div className={styles.reportLayout}><section className={styles.panel}><div className={styles.panelTitle}><span className={styles.titleIcon}><Flag size={17} /></span><div><strong>实验结果评价</strong><small>Mission debrief</small></div><button className={styles.exportButton} type="button"><Download size={14} />导出报告</button></div><div className={styles.resultStats}><div><CheckCircle2 size={18} /><span>完成任务</span><strong>5/5</strong></div><div><Users size={18} /><span>参与无人机</span><strong>15</strong></div><div><Clock3 size={18} /><span>平均完成时间</span><strong>18<span>min</span></strong></div></div><div className={styles.reportChecklist}><h3>协同任务完成情况</h3>{['区域搜索协同 · 空间分区搜索', '目标跟踪协同 · 发现、跟踪、辅助观察', '立体巡检协同 · 顶部、侧面、近距离检测', '通信中继协同 · 节点转发', '联合运输协同 · 多点运输'].map((item) => <div key={item}><CheckCircle2 size={16} /><span>{item}</span><b>完成</b></div>)}</div></section><ScoreCard score={score} /></div><div className={styles.reportConclusion}><div><strong>实验完成</strong><span>你已完成多无人机任务协同实验，建议回顾任务组与主辅角色的配置差异。</span></div><button className={styles.primaryButton} onClick={reset} type="button">重新开始实验</button></div></div>;
}
