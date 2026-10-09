import type { TheoryExamAttempt } from './exam';

export function scoreTheoryExam(attempt: TheoryExamAttempt, now = Date.now(), submissionReason: 'manual' | 'timeout' = 'manual'): TheoryExamAttempt {
  if (attempt.status !== 'IN_PROGRESS') return attempt;
  const results = attempt.questionSnapshot.map((question) => {
    const selectedAnswers = attempt.answers[question.id] ?? [];
    const correct = selectedAnswers.length === question.correctAnswers.length && question.correctAnswers.every((answer) => selectedAnswers.includes(answer));
    return { questionId: question.id, selectedAnswers: [...selectedAnswers], earnedPoints: correct ? question.points : 0, maxPoints: question.points, correct };
  });
  const total = results.reduce((sum, result) => sum + result.earnedPoints, 0);
  return { ...attempt, status: 'SUBMITTED', submittedAt: now, results, score: total, submissionReason };
}
