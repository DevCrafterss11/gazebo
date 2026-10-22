import { Award, CheckCircle2 } from 'lucide-react';

import type { CollaborationScore } from '../../../types/collaboration';
import styles from '../Collaboration.module.css';

export function ScoreCard({ score }: { score: CollaborationScore }) {
  return <div className={styles.scoreCard}><div className={styles.scoreHero}><div><span>综合评分</span><strong>{score.total}</strong><small>/ 100</small></div><Award size={39} /></div><div className={styles.scoreItems}>{[['任务完成率', score.completion], ['任务执行时间', score.duration], ['协同效果', score.coordination], ['异常处理', score.response]].map(([label, value]) => <div key={label as string}><span>{label}</span><b>{value}%</b><i><em style={{ width: `${value as number * 2.5}%` }} /></i></div>)}</div><p><CheckCircle2 size={15} />协同角色分工清晰，异常处置符合安全规范。</p></div>;
}
