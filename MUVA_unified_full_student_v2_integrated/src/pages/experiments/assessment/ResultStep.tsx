import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { tasks } from '../../../domain/assessment/model';
import { remainingExamSeconds } from '../../../domain/assessment/ExamEngine';
import { taskPoints, useAssessmentStore } from '../../../stores/assessmentStore';
import { AssessmentReportView, AssessmentSummary } from './AssessmentSummary';
import { FlightReplay } from './FlightReplay';
import { ExamReview, TheoryExam } from './TheoryExam';
import styles from './AssessmentPage.module.css';
import examStyles from './AssessmentExam.module.css';

const tabs = [{ id: 'exam', name: '01 理论考卷' }, { id: 'overall', name: '02 综合成绩' }, { id: 'review', name: '03 实验复盘' }, { id: 'report', name: '04 实验报告' }] as const;
type Tab = (typeof tabs)[number]['id'];

export function ResultStep() {
  const { run, submitReview, save, submitExam } = useAssessmentStore();
  const [tab, setTab] = useState<Tab>(run.theoryExam.status === 'SUBMITTED' ? 'overall' : 'exam');
  const [reviewTask, setReviewTask] = useState(run.reviewTask ?? '');
  const [review, setReview] = useState(run.review ?? '');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (run.theoryExam.status !== 'IN_PROGRESS') return;
    const tick = () => { const timestamp = Date.now(); setNow(timestamp); if (remainingExamSeconds(run.theoryExam, timestamp) === 0) submitExam('timeout'); };
    tick();
    const timer = window.setInterval(tick, 1000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', tick); document.removeEventListener('visibilitychange', tick); };
  }, [run.theoryExam.startedAt, run.theoryExam.durationSeconds, run.theoryExam.status, submitExam]);
  const download = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `${run.runId}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); };
  const selectedTask = run.taskResults.find((task) => task.taskId === reviewTask);
  const locked = !!run.assessmentReport;
  return <div className={examStyles.workspace}>
    <nav className={examStyles.subnav} role="tablist" aria-label="实验三终结性考核">{tabs.map((item) => <button key={item.id} role="tab" id={`assessment-tab-${item.id}`} aria-controls={`assessment-panel-${item.id}`} aria-selected={tab === item.id} onClick={() => setTab(item.id)}>{item.name}</button>)}</nav>
    <div role="tabpanel" id={`assessment-panel-${tab}`} aria-labelledby={`assessment-tab-${tab}`} className={examStyles.workspace}>
      {tab === 'exam' && <TheoryExam run={run} remaining={remainingExamSeconds(run.theoryExam, now)}/>}
      {tab === 'overall' && <AssessmentSummary run={run}/>}
      {tab === 'review' && <><div className={examStyles.replayGrid}><FlightReplay run={run} taskId={reviewTask}/><section className={styles.panel}><h2>实操复盘与扣分依据</h2><div className={styles.scroll}>{run.taskResults.map((task) => <button key={task.taskId} onClick={() => setReviewTask(task.taskId)}>{task.taskId} · {task.status} · {run.taskScores[task.taskId] ?? 0}/{taskPoints[task.taskId]} · 高度误差 {task.metrics?.altitudeError.toFixed(2) ?? '--'}m · {task.reason ?? '无异常'} · 尝试 {task.attempts} 次</button>)}</div>{selectedTask && <p>{selectedTask.feedback ?? selectedTask.reason ?? '检查高度、位置和速度'} · 位置偏差 {selectedTask.metrics?.positionError.toFixed(1) ?? '--'}m</p>}<label>选择分析任务<select value={reviewTask} disabled={locked} onChange={(event) => setReviewTask(event.target.value)}><option value="">请选择</option>{tasks.map((task) => <option value={task.taskId} key={task.taskId}>{task.goal}</option>)}</select></label><label>悬停、异常、RTL 过程及改进建议<textarea rows={6} value={review} disabled={locked} onChange={(event) => setReview(event.target.value)}/></label><button disabled={locked} onClick={() => submitReview(reviewTask, review)}>提交复盘</button><p>反思题只保留原复盘规则，不使用关键词匹配给理论考卷判分。</p></section></div><section className={styles.panel}><h2>理论错题与知识薄弱点</h2><ExamReview attempt={run.theoryExam} wrongOnly/></section></>}
      {tab === 'report' && <><AssessmentReportView run={run}/><FlightReplay run={run}/><section className={styles.panel}><h2>报告操作</h2><div className={styles.toolbar}><button className={styles.primary} disabled={locked || run.theoryExam.status !== 'SUBMITTED' || !run.review || !run.reviewTask} onClick={save}>{locked ? '综合报告已保存' : '结算并保存综合报告'}</button><button onClick={download}>导出完整 JSON</button><button onClick={() => window.print()}>打印报告</button><Link to="/records">查看历史实验</Link></div></section></>}
    </div>
  </div>;
}
