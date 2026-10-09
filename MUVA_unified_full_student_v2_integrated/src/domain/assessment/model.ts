import type { TelemetrySample } from '../../types/telemetry';
import { EXPERIMENT3_SCENES } from './experiment3Scenes';
import type { AssessmentReport, OverallStatus, PracticeStatus, TheoryExamAttempt, TheoryExamStatus } from './exam';
import { createTheoryExamAttempt } from './ExamEngine';

export const experimentId = 'quadrotor-assessment-v1';
export type TrainingMode = 'guided' | 'practice' | 'exam';
export type RunStatus = 'CREATED' | 'CONFIGURING' | 'ENVIRONMENT_STARTING' | 'READY' | 'TRAINING' | 'PAUSED' | 'RETURNING' | 'COMPLETED' | 'ABORTED' | 'FAILED' | 'INTERRUPTED';
export type TaskStatus = 'NOT_STARTED' | 'READY' | 'RUNNING' | 'PASSED' | 'FAILED' | 'INTERRUPTED';
export type EnvironmentState = 'STOPPED' | 'STARTING' | 'READY' | 'FAILED' | 'STOPPING';
export interface AssessmentConfig { altitude: number; speed: number; hoverSeconds: number; mode: 'GUIDED' | 'LOITER'; trainingMode: TrainingMode; difficulty?: 'beginner' | 'intermediate' | 'advanced' }
export const toleranceScale = (config: AssessmentConfig): number => ({ beginner: 1, intermediate: 0.8, advanced: 0.65 })[config.difficulty ?? 'beginner'];
export const defaultConfig: AssessmentConfig = { altitude: 10, speed: 3, hoverSeconds: 15, mode: 'GUIDED', trainingMode: 'guided', difficulty: 'beginner' };
export interface Evidence { id: string; runId: string; timestamp: number; type: 'ACTION' | 'COMMAND' | 'TELEMETRY' | 'TASK' | 'DIAGNOSTIC' | 'SAFETY' | 'ANOMALY' | 'SCORE'; message: string; sample?: TelemetrySample; responsibility?: 'student' | 'system'; severity?: 'general' | 'serious'; ruleId?: string }
export interface TaskDefinition { taskId: string; taskType: string; goal: string; tolerance: number; duration: number; prerequisites: string[]; scoreRule: string }
export interface TaskResult { taskId: string; status: TaskStatus; attempts: number; startedAt?: number; completedAt?: number; reason?: string; feedback?: string; stableSeconds?: number; tolerance?: number; metrics?: { altitudeError: number; positionError: number; speed: number; yawError: number } }
export const tasks: TaskDefinition[] = [
  { taskId: 'arm', taskType: 'arm', goal: '安全解锁', tolerance: 0, duration: 0, prerequisites: [], scoreRule: 'flight' },
  { taskId: 'takeoff', taskType: 'altitude', goal: '到达目标起飞高度', tolerance: 0.8, duration: 1, prerequisites: ['arm'], scoreRule: 'flight' },
  { taskId: 'hover', taskType: 'hover', goal: '定点稳定悬停', tolerance: 1.5, duration: 15, prerequisites: ['takeoff'], scoreRule: 'flight' },
  { taskId: 'vertical', taskType: 'vertical', goal: '上升 3m 再下降至目标高度', tolerance: 0.8, duration: 0, prerequisites: ['hover'], scoreRule: 'flight' },
  { taskId: 'forward', taskType: 'position', goal: '向北前进 5m', tolerance: 1.2, duration: 0, prerequisites: ['vertical'], scoreRule: 'flight' },
  { taskId: 'lateral', taskType: 'position', goal: '向东侧移 5m', tolerance: 1.2, duration: 0, prerequisites: ['forward'], scoreRule: 'flight' },
  { taskId: 'yaw', taskType: 'yaw', goal: '右转 90°', tolerance: 12, duration: 0, prerequisites: ['lateral'], scoreRule: 'flight' },
  { taskId: 'target', taskType: 'position', goal: '前往场景目标点并稳定', tolerance: 1.2, duration: 2, prerequisites: ['yaw'], scoreRule: 'flight' },
  { taskId: 'composite', taskType: 'composite', goal: '综合操控与隔离异常判断', tolerance: 1.5, duration: 2, prerequisites: ['target'], scoreRule: 'flight' },
  { taskId: 'rtl', taskType: 'rtl', goal: 'RTL 返回 Home 并安全降落', tolerance: 1.5, duration: 0, prerequisites: ['composite'], scoreRule: 'flight' },
];
export interface ScoreEntry { ruleId: string; ruleVersion: '1' | '2'; maxScore: number; actualScore: number; evidence: string[]; deductionReason: string; timestamp: number; runId: string }
export type Fault = 'normal' | 'gps' | 'ekf' | 'battery' | 'link';
export interface FlightFrame { timestamp: number; x: number; y: number; z: number; yaw: number; roll: number; pitch: number; vx: number; vy: number; vz: number; taskId?: string; battery?: number; mode?: string; armed?: boolean; event?: string }
export interface SimulationSnapshot { position: { x: number; y: number; z: number }; attitude: { roll: number; pitch: number; yaw: number }; velocity: { vx: number; vy: number; vz: number }; battery: number; armed: boolean; airborne: boolean; mode: string; flightStatus: string; homePosition: { x: number; y: number; z: number }; targetPosition: { x: number; y: number; z: number }; telemetryTimestamp: number; paused: boolean }
export const parts = [
  { id: 'frame', name: '机架', role: '连接四支机臂，承载全部设备。', principle: '刚性结构维持电机间距，并降低振动对姿态估计的影响。' },
  { id: 'motor', name: '电机', role: '驱动螺旋桨旋转。', principle: '电调接收飞控的转速指令，改变电机扭矩。' },
  { id: 'propeller', name: '螺旋桨', role: '将旋转动能转换为升力。', principle: '对角旋翼反向旋转，通过差动转速控制滚转、俯仰和航向。' },
  { id: 'controller', name: '飞控', role: '计算姿态与位置控制量。', principle: '融合传感器信息，闭环修正各电机推力。' },
  { id: 'gps', name: 'GPS', role: '提供室外定位。', principle: '与惯导观测融合；卫星数不足时限制位置控制。' },
  { id: 'imu', name: 'IMU', role: '测量加速度和角速度。', principle: '通过陀螺仪与加速度计估计短时姿态变化。' },
  { id: 'battery', name: '电池', role: '为动力系统与飞控供电。', principle: '低电量时必须评估返航或降落。' },
  { id: 'link', name: '通信模块', role: '传输遥测与飞行指令。', principle: '通信丢失时不能假定命令已到达飞控。' },
];
export const partLearning: Record<string, { connection: string; control: string; fault: string }> = {
  frame: { connection: '连接四支机臂和动力系统', control: '变形会改变各旋翼受力', fault: '结构松动会引起振动和姿态抖动' },
  motor: { connection: '接收电调指令，带动螺旋桨', control: '四台电机转速差决定机身姿态', fault: '单电机失效会失去平衡' },
  propeller: { connection: '由电机驱动，产生升力', control: '对角旋翼差速影响偏航', fault: '桨叶损伤会降低推力并增加振动' },
  controller: { connection: '接收传感器反馈并控制电调', control: '持续计算四台电机的推力分配', fault: '输出异常会导致姿态失控' },
  imu: { connection: '向飞控提供角速度和加速度', control: '帮助飞控稳定横滚与俯仰', fault: '惯导漂移会使机体无法稳定悬停' },
  gps: { connection: '向飞控提供室外位置观测', control: '支撑航点与自动返航', fault: '卫星不足时航点可能偏离目标' },
  battery: { connection: '向电机与飞控同时供电', control: '电压不足会限制可用推力', fault: '低电量时需要尽快评估降落' },
  link: { connection: '连接地面操作与飞控', control: '传递指令并回传实时遥测', fault: '失联后不应继续发送常规命令' },
};
export interface SceneConfig {
  id: string; name: string; detail: string; assetId: 'runway' | 'campus'; available: boolean;
  homePosition: { x: number; y: number; z: number }; trainingArea: { width: number; length: number };
  targetPosition: { x: number; z: number }; wind: number; visibility: number; risk: string;
  difficulty: string; color: string; size: number;
  obstacles: Array<{ id: string; position: [number, number, number]; size: [number, number, number] }>;
}
export const scenes: SceneConfig[] = [
  { id: 'runway', name: 'Runway 教学跑道', assetId: 'runway', available: true, homePosition: { x: 0, y: 0, z: 0 }, trainingArea: { width: 80, length: 80 }, targetPosition: { x: 0, z: -10 }, obstacles: [], wind: 1, visibility: 1000, size: 80, risk: '低', difficulty: '初级', detail: '开阔跑道、无障碍物，推荐基础训练', color: '#277488' },
  ...EXPERIMENT3_SCENES,
];
export interface ExperimentRun {
  experimentId: typeof experimentId; runId: string; status: RunStatus; step: number; completedSteps: number[];
  configuration: AssessmentConfig; selectedSceneId: string | null; environment: EnvironmentState; environmentError?: string;
  quizAnswers: Record<string, string>; quizSubmitted: boolean; diagnosticAnswers: Record<string, string>; faultCasePassed?: boolean; faultCaseAttempts?: number;
  safetyPassed: boolean; review?: string; reviewTask?: string; anomalyAnswer?: string; taskResults: TaskResult[]; pauseStartedAt?: number;
  learnedParts: string[]; configurationConfirmed: boolean; parameterAnswer?: string; sceneConfirmed: boolean; fault: Fault; diagnosticSubmitted: boolean; preflightConfirmed: boolean; simulationFailure?: 'scene' | 'link' | 'telemetry'; simulationLog: string[]; trajectory: FlightFrame[]; taskScores: Record<string, number>; hoverBreaks: number; anomalyChoice?: string; anomalySubmitted?: boolean;
  scoreBreakdown: ScoreEntry[]; evidence: Evidence[]; telemetrySummary: { samples: number; maxAltitude: number; maxSpeed: number; track: { north: number; east: number; altitude: number; timestamp: number }[] };
  startedAt: number; completedAt?: number; report?: string;
  theoryExam: TheoryExamAttempt; practiceScore: number; theoryScore?: number; overallScore?: number;
  practiceStatus: PracticeStatus; examStatus: TheoryExamStatus; overallStatus: OverallStatus; seriousSafetyViolation: boolean;
  systemFailure?: boolean; assessmentReport?: AssessmentReport;
}
export function createRun(): ExperimentRun {
  const runId = crypto.randomUUID();
  return { experimentId, runId, status: 'CREATED', step: 0, completedSteps: [], configuration: { ...defaultConfig }, selectedSceneId: null, environment: 'STOPPED', quizAnswers: {}, quizSubmitted: false, diagnosticAnswers: {}, safetyPassed: false, learnedParts: [], configurationConfirmed: false, sceneConfirmed: false, fault: 'normal', diagnosticSubmitted: false, preflightConfirmed: false, simulationLog: [], trajectory: [], taskScores: {}, hoverBreaks: 0, taskResults: tasks.map(({ taskId }, index) => ({ taskId, status: index === 0 ? 'READY' : 'NOT_STARTED', attempts: 0 })), scoreBreakdown: [], evidence: [], telemetrySummary: { samples: 0, maxAltitude: 0, maxSpeed: 0, track: [] }, startedAt: Date.now(), theoryExam: createTheoryExamAttempt(), practiceScore: 0, practiceStatus: 'IN_PROGRESS', examStatus: 'NOT_STARTED', overallStatus: 'PENDING_EXAM', seriousSafetyViolation: false };
}
export const questions = [
  { id: 'control', question: '哪一部件将控制指令转换为各电机转速？', choices: ['飞控与电调', 'GPS', '电池'], answer: '飞控与电调', explanation: '飞控计算控制量，电调驱动电机。' },
  { id: 'yaw', question: '四旋翼改变航向角主要依靠？', choices: ['反向旋转电机扭矩差', '整体推力', 'GPS 坐标'], answer: '反向旋转电机扭矩差', explanation: '对角电机扭矩的差值使机身绕竖轴旋转。' },
  { id: 'ekf', question: 'EKF 的主要用途是？', choices: ['融合传感器估计姿态和位置', '给电池充电', '调节桨叶长度'], answer: '融合传感器估计姿态和位置', explanation: 'EKF 融合 IMU、GPS 等观测，估计飞行状态。' },
];
export const diagnosticQuestions = [
  { id: 'gps', question: 'GPS 卫星不足时可继续执行依赖定位的航点任务吗？', answer: '不可继续' },
  { id: 'ekf', question: 'EKF 不健康时可安全执行自动返航吗？', answer: '不可继续' },
  { id: 'link', question: '心跳过期时能假定飞控仍正常吗？', answer: '不可继续' },
];
