import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRun, parts, questions } from '../src/domain/assessment/model';
import { scoreRun } from '../src/domain/assessment/ScoringEngine';
import { THEORY_QUESTION_BANK } from '../src/domain/assessment/QuestionBank';
import { answerTheoryQuestion, beginTheoryExam, createTheoryExamAttempt, remainingExamSeconds } from '../src/domain/assessment/ExamEngine';
import { scoreTheoryExam } from '../src/domain/assessment/ExamScoringEngine';
import { assessRun, buildAssessmentReport, computeOverallAssessment, hasAcknowledgedCriticalRisk, practiceScoreFromEntries } from '../src/domain/assessment/OverallScoringEngine';
import type { TelemetrySample } from '../src/types/telemetry';

test('experiment 3 theory paper has the fixed 10-question 100-point composition', () => {
  assert.equal(THEORY_QUESTION_BANK.length, 10);
  assert.equal(THEORY_QUESTION_BANK.reduce((sum, question) => sum + question.points, 0), 100);
  for (const [type, count, points] of [['single', 4, 5], ['multiple', 2, 10], ['boolean', 2, 5], ['scenario', 2, 25]] as const) {
    const selected = THEORY_QUESTION_BANK.filter((question) => question.type === type);
    assert.equal(selected.length, count);
    assert.ok(selected.every((question) => question.points === points));
  }
});

test('theory snapshots copy bank contents and incorporate recorded data without changing answers', () => {
  const run = createRun(); run.selectedSceneId = 'city';
  run.taskResults[2]!.metrics = { altitudeError: 0.2, positionError: 3.5, speed: 1.2, yawError: 4 };
  run.evidence.push({ id: 'gps-evidence', runId: run.runId, timestamp: 1000, type: 'DIAGNOSTIC', message: 'GPS 故障已经复检恢复' });
  const first = beginTheoryExam(run, 5000); const second = beginTheoryExam(run, 5000);
  assert.deepEqual(first, second);
  assert.match(first.questionSnapshot[8]!.context!, /3.50m/);
  assert.equal(first.questionSnapshot[8]!.id, 'scenario-hover-drift');
  assert.deepEqual(first.questionSnapshot[9]!.evidenceIds, ['gps-evidence']);
  for (const [index, question] of first.questionSnapshot.entries()) {
    assert.deepEqual(question.correctAnswers, THEORY_QUESTION_BANK[index]!.correctAnswers);
    assert.notEqual(question.options, THEORY_QUESTION_BANK[index]!.options);
    assert.notEqual(question.correctAnswers, THEORY_QUESTION_BANK[index]!.correctAnswers);
  }
  assert.match(beginTheoryExam(createRun(), 5000).questionSnapshot[8]!.context!, /缺少完整悬停/);
});

test('theory scoring is exact, deterministic and idempotent after submission', () => {
  const attempt = { ...createTheoryExamAttempt(), status: 'IN_PROGRESS' as const, startedAt: 1000 };
  for (const question of attempt.questionSnapshot) attempt.answers[question.id] = [...question.correctAnswers];
  const graded = scoreTheoryExam(attempt, 5000);
  assert.equal(graded.score, 100);
  assert.equal(graded.results.length, 10);
  assert.equal(graded.scoringRuleVersion, 'theory-score-v1');
  assert.deepEqual(scoreTheoryExam(attempt, 5000), graded);
  assert.equal(scoreTheoryExam(graded, 10000), graded);
  assert.equal(answerTheoryQuestion(graded, graded.questionSnapshot[0]!.id, []), graded);
});

test('multi-select has no partial credit; unattempted questions score zero', () => {
  const attempt = { ...createTheoryExamAttempt(), status: 'IN_PROGRESS' as const, startedAt: 1000 };
  const multiple = attempt.questionSnapshot.find((question) => question.type === 'multiple')!;
  attempt.answers[multiple.id] = [multiple.correctAnswers[0]!];
  assert.equal(scoreTheoryExam(attempt, 2000).score, 0);
  attempt.answers[multiple.id] = [...multiple.correctAnswers, multiple.options[2]!];
  assert.equal(scoreTheoryExam(attempt, 2000).score, 0);
  attempt.answers[multiple.id] = [...multiple.correctAnswers].reverse();
  assert.equal(scoreTheoryExam(attempt, 2000).score, 10);
});

test('absolute exam deadline survives serialization and rejects expired or invalid answers', () => {
  const attempt = beginTheoryExam(createRun(), 1000);
  const question = attempt.questionSnapshot[0]!;
  const answered = answerTheoryQuestion(attempt, question.id, question.correctAnswers, 2000);
  assert.deepEqual(answered.answers[question.id], question.correctAnswers);
  const restored = JSON.parse(JSON.stringify(answered)) as typeof answered;
  assert.equal(remainingExamSeconds(restored, 61000), 1140);
  assert.equal(remainingExamSeconds(restored, 1201000), 0);
  assert.equal(answerTheoryQuestion(restored, question.id, [], 1201000), restored);
  assert.equal(answerTheoryQuestion(attempt, question.id, ['不在试卷中的选项'], 2000), attempt);
  assert.equal(scoreTheoryExam(restored, 1201000, 'timeout').submissionReason, 'timeout');
});

test('forming quiz remains in old raw breakdown but does not contribute to final practice score', () => {
  const run = createRun(); const before = practiceScoreFromEntries(scoreRun(run));
  run.learnedParts = parts.map((part) => part.id); run.quizSubmitted = true;
  run.quizAnswers = Object.fromEntries(questions.map((question) => [question.id, question.answer]));
  assert.equal(scoreRun(run).find((entry) => entry.ruleId === 'knowledge')!.actualScore, 10);
  assert.equal(practiceScoreFromEntries(scoreRun(run)), before);
});

test('overall score uses 70/30 weights and all independent passing gates', () => {
  assert.equal(computeOverallAssessment(86, 74, 'COMPLETED', 'SUBMITTED').overallScore, 82.4);
  assert.equal(computeOverallAssessment(86, 74, 'COMPLETED', 'SUBMITTED').overallStatus, 'PASSED');
  assert.equal(computeOverallAssessment(100, undefined, 'COMPLETED', 'NOT_STARTED').overallStatus, 'PENDING_EXAM');
  assert.equal(computeOverallAssessment(100, 49, 'COMPLETED', 'SUBMITTED').overallStatus, 'FAILED');
  assert.equal(computeOverallAssessment(59, 100, 'COMPLETED', 'SUBMITTED').overallStatus, 'FAILED');
  assert.equal(computeOverallAssessment(60, 50, 'COMPLETED', 'SUBMITTED').overallStatus, 'FAILED');
  for (const status of ['FAILED', 'ABORTED', 'INTERRUPTED', 'IN_PROGRESS'] as const) assert.equal(computeOverallAssessment(100, 100, status, 'SUBMITTED').overallStatus, 'FAILED');
});

test('serious student safety and system failures keep numeric grades but have different conclusions', () => {
  const student = computeOverallAssessment(86, 74, 'COMPLETED', 'SUBMITTED', true);
  assert.equal(student.overallScore, 82.4); assert.equal(student.overallStatus, 'FAILED');
  const system = computeOverallAssessment(86, 74, 'COMPLETED', 'SUBMITTED', false, true);
  assert.equal(system.overallScore, 82.4); assert.equal(system.overallStatus, 'INVALID');
  assert.equal(system.seriousSafetyViolation, false);
  const run = createRun();
  run.evidence.push({ id: 'system', runId: run.runId, timestamp: 1, type: 'SAFETY', message: '模拟故障', severity: 'serious', responsibility: 'system', ruleId: 'critical-safety-v1' });
  assert.equal(assessRun(run).seriousSafetyViolation, false);
  run.evidence.push({ ...run.evidence[0]!, id: 'student', responsibility: 'student', message: '有明确证据的危险操作' });
  assert.equal(assessRun(run).seriousSafetyViolation, true);
});

test('saved reports retain original grading and weak domains rather than regrading on later changes', () => {
  const run = createRun(); run.step = 7;
  run.theoryExam = scoreTheoryExam(beginTheoryExam(run, 1000), 2000);
  run.assessmentReport = buildAssessmentReport(run, 3000);
  const frozen = JSON.parse(JSON.stringify(run.assessmentReport));
  run.scoreBreakdown = scoreRun(run); run.theoryExam.score = 100;
  assert.deepEqual(assessRun(run), frozen);
  assert.ok(run.assessmentReport.weakDomains.length > 0);
});

test('critical risk attribution requires both trustworthy current telemetry and prior same-run warning', () => {
  const run = createRun();
  const sample = { timestamp: 1000, batteryPercent: 5, gpsSatellites: 12, ekfStatus: { healthy: true, attitude: true, velocity: true, position: true }, mavlinkStatus: { connected: true, heartbeat: true, packetLoss: 0, source: 'mock' } } as TelemetrySample;
  assert.equal(hasAcknowledgedCriticalRisk(run, sample, 1100), false);
  run.evidence.push({ id: 'warning', runId: run.runId, timestamp: 900, type: 'SAFETY', message: '关键风险提示', sample });
  assert.equal(hasAcknowledgedCriticalRisk(run, sample, 1100), true);
  assert.equal(hasAcknowledgedCriticalRisk(run, sample, 5000), false);
  assert.equal(hasAcknowledgedCriticalRisk(run, { ...sample, batteryPercent: 90 }, 1100), false);
  assert.equal(hasAcknowledgedCriticalRisk(run, { ...sample, mavlinkStatus: { ...sample.mavlinkStatus, connected: false } }, 1100), false);
});
