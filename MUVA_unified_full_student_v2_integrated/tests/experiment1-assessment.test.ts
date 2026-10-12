import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPracticalAssessment, calculateExperiment1Score, createFinalExamSnapshot, experiment1ExamQuestions, gradeFinalExam, gradeSectionQuiz, scoreSectionQuiz, validateFinalExamSnapshot } from '../src/domain/experiment1Assessment';

test('experiment one final exam has the required fixed composition and total', () => {
  assert.equal(experiment1ExamQuestions.length, 10);
  assert.equal(experiment1ExamQuestions.filter((question) => question.kind === 'single').length, 4);
  assert.equal(experiment1ExamQuestions.filter((question) => question.kind === 'multiple').length, 2);
  assert.equal(experiment1ExamQuestions.filter((question) => question.kind === 'judgment').length, 2);
  assert.equal(experiment1ExamQuestions.filter((question) => question.kind === 'scenario').length, 2);
  assert.equal(experiment1ExamQuestions.reduce((total, question) => total + question.points, 0), 100);
  assert.equal(validateFinalExamSnapshot(experiment1ExamQuestions), null);
});

test('final exam grades exact answers and gives zero for unanswered or partially matched multiple choice', () => {
  const answers = Object.fromEntries(experiment1ExamQuestions.map((question) => [question.id, question.correctAnswer]));
  assert.equal(gradeFinalExam(experiment1ExamQuestions, answers).score, 100);
  const multiple = experiment1ExamQuestions.find((question) => question.kind === 'multiple');
  assert.ok(multiple);
  const partial = { ...answers, [multiple.id]: multiple.correctAnswer.slice(0, 1) };
  assert.equal(gradeFinalExam(experiment1ExamQuestions, partial).results.find((question) => question.id === multiple.id)?.earned, 0);
  assert.equal(gradeFinalExam(experiment1ExamQuestions, {}).score, 0);
});

test('weighted score is deterministic and does not double count section quizzes', () => {
  const quizzes = [
    scoreSectionQuiz({ quizId: 'system-cognition', title: '系统组成认知自测', step: 1, answers: {} }, 2, 3, '2026-01-01T00:00:00.000Z'),
    scoreSectionQuiz({ quizId: 'flight-diagnostics', title: '飞控诊断自测', step: 5, answers: {} }, 3, 3, '2026-01-01T00:00:00.000Z'),
  ];
  const score = calculateExperiment1Score(80, quizzes, 90);
  assert.equal(score.sectionQuizRaw, 83.33333333333334);
  assert.equal(score.total, 82.3);
  assert.equal(calculateExperiment1Score(80, [], 90).total, 74);
  assert.equal(calculateExperiment1Score(80, quizzes, null).total, null);
});

test('section quiz stores each answer, standard answer, score and explanation exactly once', () => {
  const graded = gradeSectionQuiz([
    { id: 'q1', correctAnswer: 'a', explanation: '解析 A' },
    { id: 'q2', correctAnswer: 'b', explanation: '解析 B' },
  ], { q1: 'a', q2: 'c' });
  assert.equal(graded.rawScore, 1);
  assert.equal(graded.normalizedScore, 50);
  assert.deepEqual(graded.questionResults[1], { questionId: 'q2', answer: 'c', correctAnswer: 'b', earned: 0, maxScore: 1, explanation: '解析 B' });
});

test('scenario snapshot prioritizes recorded GPS and communication evidence without changing paper composition', () => {
  const snapshot = createFinalExamSnapshot([
    { id: 'event-gps', timestamp: '2026-01-01T00:00:00.000Z', type: 'SAFETY', message: 'GPS 定位异常，暂停返航' },
    { id: 'event-link', timestamp: '2026-01-01T00:01:00.000Z', type: 'SAFETY', message: '通信心跳中断' },
  ]);
  assert.equal(snapshot.length, 10);
  assert.deepEqual(snapshot.slice(-2).map((question) => question.scenarioKey), ['gps', 'link']);
  assert.deepEqual(snapshot[8]?.evidenceEventIds, ['event-gps']);
});

test('scenario snapshot falls back to generic safety cases when no anomaly evidence exists', () => {
  const snapshot = createFinalExamSnapshot([]);
  assert.deepEqual(snapshot.slice(-2).map((question) => question.scenarioKey), ['generic-safety', 'generic-safety']);
});

test('practical assessment keeps deterministic score items and evidence references', () => {
  const practical = buildPracticalAssessment({
    experimentName: '实验一', droneName: 'Iris', sceneName: '教学场', durationSeconds: 30, score: 88, completionRate: 100, completedTasks: 10, failedTasks: 0, maxAltitude: 15, maxSpeed: 3, averageAltitudeError: 0.5, safetyEvents: ['通信检查提醒'], completedAt: '2026-01-01T00:00:00.000Z',
  }, [{ id: 'task-1', timestamp: '2026-01-01T00:00:00.000Z', type: 'TASK_COMPLETED', message: '起飞完成' }, { id: 'safe-1', timestamp: '2026-01-01T00:00:01.000Z', type: 'SAFETY', message: '通信检查提醒' }]);
  assert.equal(practical.rawScore, 88);
  assert.equal(practical.scoreItems.length, 3);
  assert.deepEqual(practical.scoreItems[0]?.evidenceEventIds, ['task-1']);
});
