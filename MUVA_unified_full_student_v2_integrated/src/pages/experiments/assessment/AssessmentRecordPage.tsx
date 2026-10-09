import { Link, useParams } from 'react-router-dom';
import { listAssessmentRecords } from '../../../stores/assessmentStore';
import { getExperiment3Scene } from '../../../domain/assessment/experiment3Scenes';
import { AssessmentReportView } from './AssessmentSummary';
import { FlightReplay } from './FlightReplay';
import styles from './AssessmentPage.module.css';

export function AssessmentRecordPage() {
  const { id } = useParams();
  const record = listAssessmentRecords().find((item) => item.runId === id);
  if (!record) return <main className={styles.page}><h1>实验三记录不存在</h1><Link to="/records">返回实验记录</Link></main>;
  return <main className={styles.page}><Link to="/records">返回实验记录</Link><h1>实验三 · {record.runId}</h1><AssessmentReportView run={record}/><FlightReplay run={record}/><section className={styles.panel}><h2>{record.configuration.trainingMode === 'practice' ? '练习评分（非正式成绩）' : '考核成绩'} {record.overallScore?.toFixed(1) ?? '待交卷'} / 100 · {record.overallStatus === 'PASSED' ? '考核通过' : record.overallStatus === 'INVALID' ? '会话无效 / 需重试' : '未通过'}</h2><p>模式 {record.configuration.trainingMode} · 难度 {record.configuration.difficulty} · 场景 {getExperiment3Scene(record.selectedSceneId)?.name ?? '未选择场景'} · 完成于 {new Date(record.completedAt ?? record.startedAt).toLocaleString()}</p><p>配置：目标高度 {record.configuration.altitude}m · 限速 {record.configuration.speed}m/s · 悬停 {record.configuration.hoverSeconds}s</p>{record.scoreBreakdown.map((score) => <p key={score.ruleId}>{score.ruleId} · {score.actualScore}/{score.maxScore} · {score.deductionReason || '无扣分'} · 规则版本 {score.ruleVersion}</p>)}<h3>任务结果</h3>{record.taskResults.map((task) => <p key={task.taskId}>{task.taskId}：{task.status} · 尝试 {task.attempts} 次 · {task.reason ?? ''}</p>)}<h3>遥测摘要 / 飞行证据</h3><p>轨迹点 {record.telemetrySummary.track.length} · 最高高度 {record.telemetrySummary.maxAltitude.toFixed(1)} m · 最高速度 {record.telemetrySummary.maxSpeed.toFixed(1)} m/s</p><p>复盘：{record.review}</p><div className={styles.timeline}>{record.evidence.filter((item) => item.type !== 'TELEMETRY').map((item, index) => <p key={`${item.timestamp}-${index}`}>{new Date(item.timestamp).toLocaleString()} · {item.type} · {item.message}</p>)}</div><button onClick={() => { const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' })); anchor.download = `${record.runId}.json`; anchor.click(); URL.revokeObjectURL(anchor.href); }}>导出完整报告 JSON</button></section></main>;
}
