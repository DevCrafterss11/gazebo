export type ExamQuestionType = 'single' | 'multiple' | 'boolean' | 'scenario';
export type TheoryExamStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED';
export type PracticeStatus = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ABORTED' | 'INTERRUPTED';
export type OverallStatus = 'PENDING_EXAM' | 'PASSED' | 'FAILED' | 'INVALID';

export interface ExamQuestion {
  id: string;
  type: ExamQuestionType;
  points: number;
  domain: string;
  prompt: string;
  options: string[];
  correctAnswers: string[];
  rationale: string;
  context?: string;
  evidenceIds?: string[];
}

export interface ExamQuestionResult {
  questionId: string;
  selectedAnswers: string[];
  earnedPoints: number;
  maxPoints: number;
  correct: boolean;
}

export interface TheoryExamAttempt {
  version: '1';
  status: TheoryExamStatus;
  durationSeconds: number;
  startedAt?: number;
  submittedAt?: number;
  contextSummary: string;
  questionSnapshot: ExamQuestion[];
  answers: Record<string, string[]>;
  results: ExamQuestionResult[];
  score?: number;
  scoringRuleVersion: 'theory-score-v1';
  currentQuestionIndex: number;
  submissionReason?: 'manual' | 'timeout';
}

export interface OverallAssessment {
  practiceScore: number;
  theoryScore?: number;
  overallScore?: number;
  practiceStatus: PracticeStatus;
  examStatus: TheoryExamStatus;
  overallStatus: OverallStatus;
  seriousSafetyViolation: boolean;
  reasons: string[];
}

export interface AssessmentReport extends OverallAssessment {
  runId: string;
  questionBankVersion: 'theory-v1';
  scoringRuleVersion: 'overall-v1';
  completedAt: number;
  weakDomains: string[];
  recommendations: string[];
  safetyAwarenessScore: number;
}
