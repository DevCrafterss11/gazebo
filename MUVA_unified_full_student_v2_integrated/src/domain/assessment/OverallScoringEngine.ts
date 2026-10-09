import type { AssessmentReport, OverallAssessment, PracticeStatus, TheoryExamStatus } from './exam';
import type { ExperimentRun, ScoreEntry } from './model';
import type { TelemetrySample } from '../../types/telemetry';

export function hasAcknowledgedCriticalRisk(run: ExperimentRun, sample: TelemetrySample | null, now = Date.now()): boolean {
  if (!sample || sample.timestamp <= 0 || now < sample.timestamp || now - sample.timestamp > 3000 || !sample.mavlinkStatus.connected || !sample.mavlinkStatus.heartbeat) return false;
  const critical = sample.batteryPercent < 10 || sample.gpsSatellites < 6 || !sample.ekfStatus.healthy;
  return critical && run.evidence.some((item) => item.type === 'SAFETY' && item.runId === run.runId && item.timestamp <= now && item.sample && (item.sample.batteryPercent < 10 || item.sample.gpsSatellites < 6 || !item.sample.ekfStatus.healthy));
}

export function practiceScoreFromEntries(entries: ScoreEntry[]): number {
  const counted = entries.filter((entry) => entry.ruleId !== 'knowledge');
  const maximum = counted.reduce((sum, entry) => sum + entry.maxScore, 0);
  const earned = counted.reduce((sum, entry) => sum + entry.actualScore, 0);
  return maximum > 0 ? Math.round(Math.max(0, Math.min(100, earned / maximum * 100)) * 10) / 10 : 0;
}

export function computeOverallAssessment(practiceScore: number, theoryScore: number | undefined, practiceStatus: PracticeStatus, examStatus: TheoryExamStatus, seriousSafetyViolation = false, systemFailure = false): OverallAssessment {
  const overallScore = theoryScore === undefined ? undefined : Math.round((practiceScore * 0.7 + theoryScore * 0.3) * 10) / 10;
  const reasons: string[] = [];
  if (systemFailure) reasons.push('Mock 系统故障：会话需重试，不归责学生');
  if (seriousSafetyViolation) reasons.push('存在有明确证据的学生责任严重安全违规');
  if (practiceStatus !== 'COMPLETED') reasons.push('实操未完整完成');
  if (practiceScore < 60) reasons.push('实操成绩未达到 60 分');
  if (theoryScore !== undefined && theoryScore < 50) reasons.push('理论成绩未达到 50 分');
  if (overallScore !== undefined && overallScore < 60) reasons.push('综合成绩未达到 60 分');
  if (examStatus !== 'SUBMITTED' || theoryScore === undefined) reasons.push('理论考卷尚未提交');
  const overallStatus = systemFailure ? 'INVALID' : examStatus !== 'SUBMITTED' || theoryScore === undefined ? 'PENDING_EXAM' : reasons.length ? 'FAILED' : 'PASSED';
  return { practiceScore, theoryScore, overallScore: examStatus === 'SUBMITTED' ? overallScore : undefined, practiceStatus, examStatus, overallStatus, seriousSafetyViolation, reasons };
}

export function assessRun(run: ExperimentRun): OverallAssessment {
  if (run.assessmentReport) return run.assessmentReport;
  const complete = run.taskResults.length === 10 && run.taskResults.every((task) => task.status === 'PASSED');
  const practiceStatus: PracticeStatus = run.status === 'ABORTED' ? 'ABORTED' : complete ? 'COMPLETED' : run.status === 'FAILED' ? 'FAILED' : run.status === 'INTERRUPTED' ? 'INTERRUPTED' : run.step === 7 ? 'FAILED' : 'IN_PROGRESS';
  const serious = run.evidence.some((item) => item.type === 'SAFETY' && item.responsibility === 'student' && item.severity === 'serious' && item.ruleId === 'critical-safety-v1');
  return computeOverallAssessment(practiceScoreFromEntries(run.scoreBreakdown), run.theoryExam.score, practiceStatus, run.theoryExam.status, serious, run.systemFailure === true);
}

export function buildAssessmentReport(run: ExperimentRun, completedAt = Date.now()): AssessmentReport {
  const assessment = assessRun(run);
  const weakDomains = [...new Set(run.theoryExam.results.filter((item) => !item.correct).map((item) => run.theoryExam.questionSnapshot.find((question) => question.id === item.questionId)?.domain ?? '未分类'))];
  const safetyQuestions = run.theoryExam.questionSnapshot.filter((question) => ['起飞安全', '故障应急', '情景分析'].includes(question.domain));
  const maximum = safetyQuestions.reduce((sum, question) => sum + question.points, 0);
  const earned = run.theoryExam.results.filter((item) => safetyQuestions.some((question) => question.id === item.questionId)).reduce((sum, item) => sum + item.earnedPoints, 0);
  return {
    ...assessment, runId: run.runId, questionBankVersion: 'theory-v1', scoringRuleVersion: 'overall-v1', completedAt, weakDomains,
    recommendations: [assessment.practiceStatus !== 'COMPLETED' ? '实操尚未完整完成，结合任务失败原因和轨迹重新训练。' : '结合轨迹和原实操明细复习误差控制与安全决策。', weakDomains.length ? `优先复习：${weakDomains.join('、')}，对照错题解析与传感器记录。` : '理论知识掌握良好，继续巩固安全处置与实际操作的联系。', ...(run.systemFailure ? ['本次有 Mock 系统故障，请重新建立有效实验会话。'] : [])],
    safetyAwarenessScore: maximum > 0 ? Math.round(earned / maximum * 100) : 0,
  };
}
