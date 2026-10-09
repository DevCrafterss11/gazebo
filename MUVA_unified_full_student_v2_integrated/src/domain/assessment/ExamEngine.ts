import type { TheoryExamAttempt } from './exam';
import { THEORY_QUESTION_BANK, THEORY_EXAM_DURATION_SECONDS, SCENARIO_QUESTION_VARIANTS } from './QuestionBank';
import type { ExperimentRun } from './model';
import { getExperiment3Scene } from './experiment3Scenes';

export function createTheoryExamAttempt(): TheoryExamAttempt {
  return {
    version: '1', status: 'NOT_STARTED', durationSeconds: THEORY_EXAM_DURATION_SECONDS,
    contextSummary: '', questionSnapshot: THEORY_QUESTION_BANK.map((question) => ({ ...question, options: [...question.options], correctAnswers: [...question.correctAnswers] })),
    answers: {}, results: [], scoringRuleVersion: 'theory-score-v1', currentQuestionIndex: 0,
  };
}

export function beginTheoryExam(run: ExperimentRun, now = Date.now()): TheoryExamAttempt {
  const attempt = createTheoryExamAttempt();
  const scene = getExperiment3Scene(run.selectedSceneId);
  const hover = run.taskResults.find((task) => task.taskId === 'hover');
  const latestFaults = run.evidence.filter((item) => item.type === 'DIAGNOSTIC' || item.type === 'SAFETY').slice(-3);
  return {
    ...attempt, status: 'IN_PROGRESS', startedAt: now,
    contextSummary: `Run ${run.runId.slice(0, 8)} · ${scene?.name ?? '未选择场景'} · 已完成 ${run.taskResults.filter((task) => task.status === 'PASSED').length}/${run.taskResults.length} 项实操任务`,
    questionSnapshot: attempt.questionSnapshot.map((question) => {
      const source = question.id === 'scenario-safety' && latestFaults.some((item) => /GPS|定位/.test(item.message)) ? SCENARIO_QUESTION_VARIANTS.gpsWarning : question.id === 'scenario-hover' && hover?.metrics && hover.metrics.positionError > 1.5 && (scene?.wind ?? 0) > 0 ? SCENARIO_QUESTION_VARIANTS.hoverDrift : question;
      const snapshot = { ...source, options: [...source.options], correctAnswers: [...source.correctAnswers] };
      if (question.id === 'scenario-safety') return { ...snapshot, context: latestFaults.length ? `本次记录：${latestFaults.map((item) => item.message).join('；')}。以下标准情境检验处置原则，不代表本次出现全部故障。` : '本次无传感器或安全异常记录，使用统一标准情境。', evidenceIds: latestFaults.map((item) => item.id) };
      if (question.id !== 'scenario-hover') return question;
      return { ...snapshot, context: hover?.metrics ? `本次悬停：位置误差 ${hover.metrics.positionError.toFixed(2)}m，高度误差 ${hover.metrics.altitudeError.toFixed(2)}m，速度 ${hover.metrics.speed.toFixed(2)}m/s；场景模拟风速 ${scene?.wind ?? 0}m/s。请结合数据理解以下标准情境。` : '本次缺少完整悬停测量，使用统一标准情境，不推断未记录的偏差。', evidenceIds: run.evidence.filter((item) => item.type === 'TASK' && item.message.includes('hover')).map((item) => item.id) };
    }),
  };
}

export function remainingExamSeconds(attempt: TheoryExamAttempt, now = Date.now()): number {
  if (attempt.status === 'SUBMITTED') return 0;
  if (attempt.startedAt === undefined) return attempt.durationSeconds;
  return Math.max(0, Math.ceil((attempt.startedAt + attempt.durationSeconds * 1000 - now) / 1000));
}

export function answerTheoryQuestion(attempt: TheoryExamAttempt, questionId: string, answers: string[], now = Date.now()): TheoryExamAttempt {
  if (attempt.status !== 'IN_PROGRESS' || remainingExamSeconds(attempt, now) === 0) return attempt;
  const question = attempt.questionSnapshot.find((item) => item.id === questionId);
  if (!question || answers.some((answer) => !question.options.includes(answer))) return attempt;
  const selected = question.options.filter((option) => answers.includes(option));
  if (question.type !== 'multiple' && selected.length > 1) return attempt;
  return { ...attempt, answers: { ...attempt.answers, [questionId]: selected } };
}
