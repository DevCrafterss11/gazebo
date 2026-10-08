import { diagnosticQuestions, questions, parts, type ExperimentRun, type ScoreEntry } from './model';

const rules = [ ['knowledge', 10], ['preparation', 10], ['diagnostic', 20], ['flight', 35], ['anomaly', 15], ['review', 10] ] as const;
export function largestAltitudeErrorTask(run: ExperimentRun): string | null {
  const measured = run.taskResults.filter((task) => task.taskId !== 'arm' && task.taskId !== 'rtl' && task.status === 'PASSED' && task.metrics && Number.isFinite(task.metrics.altitudeError));
  return measured.reduce<(typeof measured)[number] | null>((largest, task) => !largest || (task.metrics?.altitudeError ?? 0) > (largest.metrics?.altitudeError ?? 0) ? task : largest, null)?.taskId ?? null;
}
export function scoreRun(run: ExperimentRun): ScoreEntry[] {
  const correctQuiz = questions.filter((question) => run.quizAnswers[question.id] === question.answer).length;
  const correctDiagnosis = diagnosticQuestions.filter((question) => run.diagnosticAnswers[question.id] === question.answer).length;
  const knowledge = run.quizSubmitted && run.learnedParts.length === parts.length ? 10 * correctQuiz / questions.length : 0;
  const preparation = run.configurationConfirmed && run.sceneConfirmed ? (run.parameterAnswer === '高度决定起飞及悬停目标' ? 10 : 6) : 0;
  const diagnostics = run.diagnosticSubmitted ? 10 * correctDiagnosis / diagnosticQuestions.length : 0;
  const flight = run.taskResults.reduce((points, result) => points + (result.status === 'PASSED' ? run.taskScores[result.taskId] ?? 0 : 0), 0);
  const values = [knowledge, preparation, diagnostics + (run.preflightConfirmed && run.safetyPassed ? 10 : 0), flight, run.anomalySubmitted ? (run.anomalyAnswer === '暂停任务并评估返航' ? 10 : 0) + (run.anomalyChoice === '先确认故障并保持安全飞行高度' ? 5 : 0) : 0, run.review?.trim() && run.reviewTask === largestAltitudeErrorTask(run) ? 10 : 0];
  return rules.map(([ruleId, maxScore], index) => ({ ruleId, ruleVersion: '1', maxScore, actualScore: Math.round((values[index] ?? 0) * 10) / 10, evidence: run.evidence.filter((item) => item.type !== 'TELEMETRY').slice(-40).map((item) => `${item.timestamp}:${item.type}:${item.message}`), deductionReason: (values[index] ?? 0) < maxScore ? '未完成或未达到规则要求' : '', timestamp: Date.now(), runId: run.runId }));
}
export function totalScore(entries: ScoreEntry[]): number { return Math.round(entries.reduce((sum, entry) => sum + entry.actualScore, 0) * 10) / 10; }
