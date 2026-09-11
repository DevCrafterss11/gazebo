export type ExperimentStepStatus = 'completed' | 'active' | 'pending';
export type TrainingTaskStatus = 'LOCKED' | 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'FAILED';

export type ExperimentProgressStatus = 'waiting' | 'checking' | 'pass' | 'fail';

export interface ExperimentProgressEvent {
  type: 'sensor_check' | 'preflight_check';
  step: string;
  status: ExperimentProgressStatus;
}

export interface ExperimentStep {
  id: number;
  title: string;
  status: ExperimentStepStatus;
}

export interface TrainingTask {
  id: number;
  title: string;
  status: TrainingTaskStatus;
  goal: string;
  completionCondition: string;
  progress: number;
}

export interface ExperimentDefinition {
  id: string;
  title: string;
  subtitle: string;
  currentStep: number;
  steps: ExperimentStep[];
  tasks: TrainingTask[];
}

export interface ExperimentWorkflowState {
  currentStep: number;
  completedSteps: number[];
}

export interface TrainingScore {
  score: number;
  maximumScore: number;
  progressPercent: number;
  completedTasks: number;
  totalTasks: number;
  feedback: string[];
}

export interface SetupOption {
  id: string;
  label: string;
  value: string;
  status: 'ready' | 'recommended' | 'normal';
}

export interface SetupStepDefinition {
  stepId: number;
  title: string;
  description: string;
  options: SetupOption[];
  checklist: string[];
}
