export interface ExperimentResult {
  experimentName: string;
  droneName: string;
  sceneName: string;
  durationSeconds: number;
  score: number;
  completionRate: number;
  completedTasks: number;
  failedTasks: number;
  maxAltitude: number;
  maxSpeed: number;
  averageAltitudeError: number;
  safetyEvents: string[];
  completedAt: string;
}
