import { parts, questions } from './assessment/model';
import type { PersistedExperimentState } from '../services/contracts';

export function experiment1LearningError(step: number, state: Pick<PersistedExperimentState, 'learningProgress' | 'assessment'>): string | null {
  if (step === 1 && !parts.every((part) => state.learningProgress?.learnedPartIds.includes(part.id))) return '请先学习全部八个机体部件';
  const quizId = step === 1 ? 'system-cognition' : step === 5 ? 'flight-diagnostics' : null;
  if (!quizId) return null;
  const quiz = state.assessment?.sectionQuizzes.find((item) => item.quizId === quizId);
  const questionIds = step === 1 ? questions.map((question) => question.id) : ['gps', 'ekf', 'heartbeat'];
  return quiz?.status === 'SUBMITTED' && questionIds.every((id) => Boolean(quiz.answers[id]))
    ? null : step === 1 ? '请回答并提交系统组成认知自测' : '请回答并提交飞控诊断自测';
}
