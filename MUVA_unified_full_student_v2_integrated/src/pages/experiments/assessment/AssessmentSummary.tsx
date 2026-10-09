import type { ExperimentRun } from '../../../domain/assessment/model';
import { assessRun, buildAssessmentReport } from '../../../domain/assessment/OverallScoringEngine';
import { getExperiment3Scene } from '../../../domain/assessment/experiment3Scenes';
import { ExamReview } from './TheoryExam';
import styles from './AssessmentPage.module.css';
import examStyles from './AssessmentExam.module.css';

export const overallNames = { PENDING_EXAM: '综合成绩待结算', PASSED: '考核通过', FAILED: '未通过', INVALID: '会话无效 / 需重试' };

export function AssessmentSummary({ run }: { run: ExperimentRun }) {
  const assessment = assessRun(run);
  return <><div className={examStyles.summaryGrid}><section className={styles.panel}><h2>综合成绩 · {overallNames[assessment.overallStatus]}</h2><div className={examStyles.scoreValue}>{assessment.overallScore?.toFixed(1) ?? '—'} <small>/ 100</small></div><p>综合成绩 = 0.7 × 实操 + 0.3 × 理论</p><p>{run.assessmentReport ? '已保存最终综合成绩' : '当前预结算成绩；提交复盘后保存最终报告'}</p></section><section className={styles.panel}><h2>飞行实操 · 权重 70%</h2><div className={examStyles.scoreValue}>{assessment.practiceScore.toFixed(1)} <small>/ 100</small></div><p>任务完成 {run.taskResults.filter((task) => task.status === 'PASSED').length} / 10</p><p>实操状态：{assessment.practiceStatus}</p></section><section className={styles.panel}><h2>理论考核 · 权重 30%</h2><div className={examStyles.scoreValue}>{assessment.theoryScore?.toFixed(1) ?? '待交卷'} <small>/ 100</small></div><p>考卷状态：{assessment.examStatus}</p></section></div>
    <section className={styles.panel}><h2>合格判定</h2><p>综合 ≥ 60，实操 ≥ 60，理论 ≥ 50；实操完整完成，且不存在有明确证据的学生责任严重安全违规。</p>{assessment.reasons.map((reason) => <p key={reason}>• {reason}</p>)}<p>一般飞行误差仍在原实操评分中处理，不再次扣分。Mock 故障不直接判为学生违规。</p></section>
    <section className={styles.panel}><h2>原实操评分明细</h2>{run.scoreBreakdown.map((item) => <div className={styles.metric} key={item.ruleId}><span>{item.ruleId === 'knowledge' ? 'knowledge · 形成性自测，不计最终成绩' : item.ruleId}</span><strong>{item.actualScore} / {item.maxScore}</strong><small>{item.deductionReason || '已满足规则'} · 规则 {item.ruleVersion}</small></div>)}<p>保留原六维评分规则与证据。知识自测不重复计分，其余原始 90 分按比例归一化为实操百分制。</p></section></>;
}

export function AssessmentReportView({ run }: { run: ExperimentRun }) {
  const report = run.assessmentReport ?? buildAssessmentReport(run);
  return <div className={examStyles.workspace}><AssessmentSummary run={run}/><section className={styles.panel}><h2>实验三 · 综合考核报告</h2><p>Run {run.runId} · 场景 {getExperiment3Scene(run.selectedSceneId)?.name ?? '未选择'} · Iris 四旋翼</p><p>理论题库版本 {report.questionBankVersion} · 理论评分 {run.theoryExam.scoringRuleVersion} · 综合评分 {report.scoringRuleVersion}</p><p>安全意识诊断指标：{run.examStatus === 'SUBMITTED' ? `${report.safetyAwarenessScore}/100` : '待交卷'}（独立诊断，不额外加入总分）</p><h3>针对性改进建议</h3>{report.recommendations.map((item) => <p key={item}>{item}</p>)}<p>实操复盘：{run.review ?? '尚未提交'}</p><p>轨迹 {run.trajectory.length} 帧 · 遥测 {run.telemetrySummary.samples} 次 · 最高高度 {run.telemetrySummary.maxAltitude.toFixed(1)}m · 最高速度 {run.telemetrySummary.maxSpeed.toFixed(1)}m/s</p><p>纯前端 Mock 成绩仅用于教学演示。正式阅卷、防作弊和持久化应在未来后端完成。</p></section><section className={styles.panel}><h2>考卷答案与解析</h2><ExamReview attempt={run.theoryExam}/></section></div>;
}
