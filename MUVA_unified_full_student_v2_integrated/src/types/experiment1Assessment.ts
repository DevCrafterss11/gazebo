export type ExamQuestionKind = 'single' | 'multiple' | 'judgment' | 'scenario';
export type ExamStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'SUBMITTED';
export type AssessmentStatus = 'IN_PROGRESS' | 'AWAITING_EXAM' | 'EXAM_IN_PROGRESS' | 'AWAITING_FINALIZATION' | 'GRADED' | 'ERROR';

export interface ExamQuestion {
  id: string;
  kind: ExamQuestionKind;
  prompt: string;
  options: { id: string; label: string }[];
  correctAnswer: string[];
  points: number;
  explanation: string;
  knowledge: 'basics' | 'flight-control' | 'safety' | 'flight-operation' | 'exception';
  scenarioKey?: 'gps' | 'link' | 'generic-safety';
  evidenceEventIds?: string[];
}

export interface ExamQuestionResult extends ExamQuestion {
  answer: string[];
  earned: number;
}

export interface SectionQuizQuestionDefinition {
  id: string;
  correctAnswer: string;
  explanation: string;
}

export interface SectionQuizQuestionResult {
  questionId: string;
  answer: string;
  correctAnswer: string;
  earned: number;
  maxScore: number;
  explanation: string;
}

export interface SectionQuizAssessment {
  quizId: 'system-cognition' | 'flight-diagnostics';
  title: string;
  step: number;
  status: 'SUBMITTED';
  answers: Record<string, string>;
  questionResults: SectionQuizQuestionResult[];
  correctCount: number;
  questionCount: number;
  rawScore: number;
  maxScore: number;
  normalizedScore: number;
  submittedAt: string;
}

export interface PracticalEvidenceEvent {
  id: string;
  timestamp: string;
  type: 'TRAINING' | 'TASK_COMPLETED' | 'SAFETY';
  message: string;
}

export interface PracticalScoreItem {
  id: string;
  label: string;
  maxScore: number;
  actualScore: number;
  status: 'COMPLETED' | 'PARTIAL' | 'NOT_COMPLETED';
  deductionReason: string;
  evidenceEventIds: string[];
  improvement: string;
}

export interface PracticalAssessment {
  rawScore: number;
  scoreItems: PracticalScoreItem[];
  evidenceEvents: PracticalEvidenceEvent[];
  source: 'training-engine';
  recordedAt: string;
}

export interface ExperimentOneExam {
  status: ExamStatus;
  version: string;
  questionSnapshot: ExamQuestion[];
  answers: Record<string, string[]>;
  startedAt: string | null;
  deadline: string | null;
  submittedAt: string | null;
  rawScore: number | null;
  questionResults: ExamQuestionResult[];
}

export interface ExperimentOneAssessment {
  sessionId: string;
  scoringVersion: 'experiment1-v2';
  status: AssessmentStatus;
  sectionQuizzes: SectionQuizAssessment[];
  exam: ExperimentOneExam;
  practicalAssessment: PracticalAssessment | null;
  practicalResult?: import('./result').ExperimentResult;
  finalResult: ScoreBreakdown | null;
  finalizedAt: string | null;
  totalScore: number | null;
}

export interface ScoreBreakdown {
  practicalRaw: number;
  practicalWeighted: number;
  sectionQuizRaw: number | null;
  sectionQuizWeighted: number | null;
  examRaw: number | null;
  examWeighted: number | null;
  total: number | null;
}
