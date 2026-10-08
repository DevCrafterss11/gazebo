import { Link, useParams } from 'react-router-dom';
import { listAssessmentRecords } from '../../../stores/assessmentStore';
import { totalScore } from '../../../domain/assessment/ScoringEngine';
import styles from './AssessmentPage.module.css';

export function AssessmentRecordPage() {
  const { id } = useParams();
  const record = listAssessmentRecords().find((item) => item.runId === id);
  if (!record) return <main className={styles.page}><h1>实验三记录不存在</h1><Link to="/records">返回实验记录</Link></main>;
  return <main className={styles.page}><Link to="/records">返回实验记录</Link><h1>实验三 · {record.runId}</h1><section className={styles.panel}><h2>正式成绩 {totalScore(record.scoreBreakdown)} / 100</h2><p>模式 {record.configuration.trainingMode} · 场景 {record.scene} · 完成于 {new Date(record.completedAt ?? record.startedAt).toLocaleString()}</p>{record.scoreBreakdown.map((score) => <p key={score.ruleId}>{score.ruleId} · {score.actualScore}/{score.maxScore} · {score.deductionReason || '无扣分'} · 规则版本 {score.ruleVersion}</p>)}<h3>任务结果</h3>{record.taskResults.map((task) => <p key={task.taskId}>{task.taskId}：{task.status} · 尝试 {task.attempts} 次 · {task.reason ?? ''}</p>)}<h3>遥测摘要 / 飞行证据</h3><p>轨迹点 {record.telemetrySummary.track.length} · 最高高度 {record.telemetrySummary.maxAltitude.toFixed(1)} m · 最高速度 {record.telemetrySummary.maxSpeed.toFixed(1)} m/s</p><p>复盘：{record.review}</p><div className={styles.timeline}>{record.evidence.filter((item) => item.type !== 'TELEMETRY').map((item, index) => <p key={`${item.timestamp}-${index}`}>{new Date(item.timestamp).toLocaleString()} · {item.type} · {item.message}</p>)}</div><button onClick={() => { const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' })); anchor.download = `${record.runId}.json`; anchor.click(); URL.revokeObjectURL(anchor.href); }}>导出完整报告 JSON</button></section></main>;
}
