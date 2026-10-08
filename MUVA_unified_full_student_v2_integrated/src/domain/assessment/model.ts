import type { TelemetrySample } from '../../types/telemetry';

export const experimentId = 'quadrotor-assessment-v1';
export type TrainingMode = 'guided' | 'practice' | 'exam';
export type RunStatus = 'CREATED' | 'CONFIGURING' | 'ENVIRONMENT_STARTING' | 'READY' | 'TRAINING' | 'PAUSED' | 'RETURNING' | 'COMPLETED' | 'ABORTED' | 'FAILED';
export type TaskStatus = 'NOT_STARTED' | 'READY' | 'RUNNING' | 'PASSED' | 'FAILED' | 'INTERRUPTED';
export type EnvironmentState = 'STOPPED' | 'STARTING' | 'READY' | 'FAILED' | 'STOPPING';
export interface AssessmentConfig { altitude: number; speed: number; hoverSeconds: number; mode: 'GUIDED' | 'LOITER'; trainingMode: TrainingMode; difficulty?: 'beginner' | 'intermediate' | 'advanced' }
export const defaultConfig: AssessmentConfig = { altitude: 10, speed: 3, hoverSeconds: 15, mode: 'GUIDED', trainingMode: 'guided', difficulty: 'beginner' };
export interface Evidence { id: string; runId: string; timestamp: number; type: 'ACTION' | 'COMMAND' | 'TELEMETRY' | 'TASK' | 'DIAGNOSTIC' | 'SAFETY' | 'ANOMALY' | 'SCORE'; message: string; sample?: TelemetrySample }
export interface TaskDefinition { taskId: string; taskType: string; goal: string; tolerance: number; duration: number; prerequisites: string[]; scoreRule: string }
export interface TaskResult { taskId: string; status: TaskStatus; attempts: number; startedAt?: number; completedAt?: number; reason?: string; metrics?: { altitudeError: number; positionError: number; speed: number; yawError: number } }
export const tasks: TaskDefinition[] = [
  { taskId: 'arm', taskType: 'arm', goal: '安全解锁', tolerance: 0, duration: 0, prerequisites: [], scoreRule: 'flight' },
  { taskId: 'takeoff', taskType: 'altitude', goal: '到达目标起飞高度', tolerance: 0.8, duration: 1, prerequisites: ['arm'], scoreRule: 'flight' },
  { taskId: 'hover', taskType: 'hover', goal: '定点稳定悬停', tolerance: 1.5, duration: 15, prerequisites: ['takeoff'], scoreRule: 'flight' },
  { taskId: 'vertical', taskType: 'vertical', goal: '上升 3m 再下降至目标高度', tolerance: 0.8, duration: 0, prerequisites: ['hover'], scoreRule: 'flight' },
  { taskId: 'forward', taskType: 'position', goal: '向北前进 5m', tolerance: 1.2, duration: 0, prerequisites: ['vertical'], scoreRule: 'flight' },
  { taskId: 'lateral', taskType: 'position', goal: '向东侧移 5m', tolerance: 1.2, duration: 0, prerequisites: ['forward'], scoreRule: 'flight' },
  { taskId: 'yaw', taskType: 'yaw', goal: '右转 90°', tolerance: 12, duration: 0, prerequisites: ['lateral'], scoreRule: 'flight' },
  { taskId: 'target', taskType: 'position', goal: '前往指定目标点（北 5m）', tolerance: 1.2, duration: 0, prerequisites: ['yaw'], scoreRule: 'flight' },
  { taskId: 'composite', taskType: 'composite', goal: '综合操控与隔离异常判断', tolerance: 1.5, duration: 2, prerequisites: ['target'], scoreRule: 'flight' },
  { taskId: 'rtl', taskType: 'rtl', goal: 'RTL 返回 Home 并安全降落', tolerance: 1.5, duration: 0, prerequisites: ['composite'], scoreRule: 'flight' },
];
export interface ScoreEntry { ruleId: string; ruleVersion: '1'; maxScore: number; actualScore: number; evidence: string[]; deductionReason: string; timestamp: number; runId: string }
export type Fault = 'normal' | 'gps' | 'ekf' | 'battery' | 'link';
export interface FlightFrame { timestamp: number; x: number; y: number; z: number; yaw: number; roll: number; pitch: number; vx: number; vy: number; vz: number; taskId?: string }
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
export interface SceneConfig {
  id: string; name: string; detail: string; assetId: 'runway' | 'campus'; available: boolean;
  homePosition: { x: number; y: number; z: number }; trainingArea: { width: number; length: number };
  targetPosition: { x: number; z: number }; wind: number; visibility: number; risk: string;
  difficulty: string; color: string; size: number;
  obstacles: Array<{ id: string; position: [number, number, number]; size: [number, number, number] }>;
}
export const scenes: SceneConfig[] = [
  { id: 'runway', name: 'Runway 教学跑道', assetId: 'runway', available: true, homePosition: { x: 0, y: 0, z: 0 }, trainingArea: { width: 80, length: 80 }, targetPosition: { x: 0, z: -10 }, obstacles: [], wind: 1, visibility: 1000, size: 80, risk: '低', difficulty: '初级', detail: '开阔跑道、无障碍物，推荐基础训练', color: '#277488' },
  { id: 'campus', name: '校园训练场', assetId: 'campus', available: true, homePosition: { x: 0, y: 0, z: 0 }, trainingArea: { width: 65, length: 65 }, targetPosition: { x: 8, z: -10 }, obstacles: [{ id: 'teaching-block', position: [21, 3, -17], size: [8, 6, 12] }, { id: 'library', position: [-20, 2.5, 12], size: [8, 5, 10] }], wind: 2, visibility: 700, size: 65, risk: '中', difficulty: '中级', detail: '建筑位于训练区外，需保持障碍距离', color: '#41725b' },
  { id: 'city', name: '城市训练场（建设中）', assetId: 'runway', available: false, homePosition: { x: 0, y: 0, z: 0 }, trainingArea: { width: 50, length: 50 }, targetPosition: { x: 0, z: -10 }, obstacles: [], wind: 3, visibility: 500, size: 50, risk: '高', difficulty: '高级', detail: '城市立体场景尚未接入', color: '#5f7395' },
  { id: 'mountain', name: '山地训练场（建设中）', assetId: 'runway', available: false, homePosition: { x: 0, y: 0, z: 0 }, trainingArea: { width: 65, length: 65 }, targetPosition: { x: 0, z: -10 }, obstacles: [], wind: 4, visibility: 500, size: 65, risk: '高', difficulty: '高级', detail: '山地场景尚未接入', color: '#8c7566' },
];
export interface ExperimentRun {
  experimentId: typeof experimentId; runId: string; status: RunStatus; step: number; completedSteps: number[];
  configuration: AssessmentConfig; scene: string | null; environment: EnvironmentState; environmentError?: string;
  quizAnswers: Record<string, string>; quizSubmitted: boolean; diagnosticAnswers: Record<string, string>;
  safetyPassed: boolean; review?: string; reviewTask?: string; anomalyAnswer?: string; taskResults: TaskResult[];
  learnedParts: string[]; configurationConfirmed: boolean; parameterAnswer?: string; sceneConfirmed: boolean; fault: Fault; diagnosticSubmitted: boolean; preflightConfirmed: boolean; simulationFailure?: 'scene' | 'link' | 'telemetry'; simulationLog: string[]; trajectory: FlightFrame[]; taskScores: Record<string, number>; hoverBreaks: number; anomalyChoice?: string; anomalySubmitted?: boolean;
  scoreBreakdown: ScoreEntry[]; evidence: Evidence[]; telemetrySummary: { samples: number; maxAltitude: number; maxSpeed: number; track: { north: number; east: number; altitude: number; timestamp: number }[] };
  startedAt: number; completedAt?: number; report?: string;
}
export function createRun(): ExperimentRun {
  return { experimentId, runId: crypto.randomUUID(), status: 'CREATED', step: 0, completedSteps: [], configuration: { ...defaultConfig }, scene: null, environment: 'STOPPED', quizAnswers: {}, quizSubmitted: false, diagnosticAnswers: {}, safetyPassed: false, learnedParts: [], configurationConfirmed: false, sceneConfirmed: false, fault: 'normal', diagnosticSubmitted: false, preflightConfirmed: false, simulationLog: [], trajectory: [], taskScores: {}, hoverBreaks: 0, taskResults: tasks.map(({ taskId }, index) => ({ taskId, status: index === 0 ? 'READY' : 'NOT_STARTED', attempts: 0 })), scoreBreakdown: [], evidence: [], telemetrySummary: { samples: 0, maxAltitude: 0, maxSpeed: 0, track: [] }, startedAt: Date.now() };
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
