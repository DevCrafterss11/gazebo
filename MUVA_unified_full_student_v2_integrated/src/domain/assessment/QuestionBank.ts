import type { ExamQuestion } from './exam';

export const THEORY_EXAM_VERSION = 'theory-v1';
export const THEORY_EXAM_DURATION_SECONDS = 20 * 60;

export const THEORY_QUESTION_BANK: ExamQuestion[] = [
  {
    id: 'principle-attitude', type: 'single', points: 5, domain: '无人机飞行原理',
    prompt: '四旋翼主要通过什么方式改变滚转、俯仰和航向姿态？',
    options: ['差动调节各电机转速和扭矩', '只改变 GPS 坐标', '关闭 IMU 后手动保持姿态', '同时提高所有电机转速'],
    correctAnswers: ['差动调节各电机转速和扭矩'],
    rationale: '飞控根据姿态误差差动分配四个电机的推力和扭矩，形成滚转、俯仰或航向变化。',
  },
  {
    id: 'sensor-ekf', type: 'single', points: 5, domain: '飞控与传感器',
    prompt: 'EKF 在飞行控制中的主要作用是什么？',
    options: ['融合多源传感器，估计姿态和位置', '提高电池容量', '直接替代螺旋桨', '只记录飞行截图'],
    correctAnswers: ['融合多源传感器，估计姿态和位置'],
    rationale: 'EKF 会融合 IMU、GPS 等观测，输出更稳定的状态估计供控制器使用。',
  },
  {
    id: 'hover-first-check', type: 'single', points: 5, domain: '飞行操作',
    prompt: '无人机无法达到规定的悬停稳定性要求，首先应该检查什么？',
    options: ['位置误差、速度和环境扰动', '直接提高最大飞行速度', '关闭所有传感器', '跳过悬停任务'],
    correctAnswers: ['位置误差、速度和环境扰动'],
    rationale: '应先确认误差、速度和风扰动等可观测原因，再决定调整、暂停或降落。',
  },
  {
    id: 'rtl-purpose', type: 'single', points: 5, domain: '飞行操作',
    prompt: 'RTL 指令的正确理解是什么？',
    options: ['请求无人机返回 Home，并等待遥测确认返航和降落', '只要发送一次就代表已经安全降落', '忽略 GPS 和通信状态强制继续飞行', '自动修复所有飞控故障'],
    correctAnswers: ['请求无人机返回 Home，并等待遥测确认返航和降落'],
    rationale: '命令确认不等于任务完成，必须结合位置、高度、模式和解锁状态确认安全降落。',
  },
  {
    id: 'preflight-conditions', type: 'multiple', points: 10, domain: '起飞安全',
    prompt: '以下哪些项目属于起飞前必须确认的安全条件？（多选）',
    options: ['环境 READY 且遥测新鲜', 'GPS 和 EKF 状态满足要求', '明知通信过期仍直接解锁', 'Home 点和飞行模式已确认', '电池严重不足但任务时间较长'],
    correctAnswers: ['环境 READY 且遥测新鲜', 'GPS 和 EKF 状态满足要求', 'Home 点和飞行模式已确认'],
    rationale: '起飞前需要确认环境、遥测、定位、估计器、Home、模式和电量等条件，不能用危险状态替代检查。',
  },
  {
    id: 'fault-response', type: 'multiple', points: 10, domain: '故障应急',
    prompt: '发现传感器或通信异常时，哪些处理原则是合理的？（多选）',
    options: ['暂停继续执行依赖异常数据的任务', '根据最新有效遥测评估返航或降落', '不确认状态就连续发送更多控制指令', '记录异常并完成故障复检', '把 Mock 故障直接当成学生违规'],
    correctAnswers: ['暂停继续执行依赖异常数据的任务', '根据最新有效遥测评估返航或降落', '记录异常并完成故障复检'],
    rationale: '异常处置应优先稳定状态、减少风险并复检；系统故障不能直接归责学生。',
  },
  {
    id: 'command-ack', type: 'boolean', points: 5, domain: '飞行操作',
    prompt: '飞控返回“命令已接受”，就可以直接认为无人机已经完成该任务。',
    options: ['正确', '错误'],
    correctAnswers: ['错误'],
    rationale: '命令接受只是控制链路的反馈，任务是否达标仍需由后续遥测和任务规则判定。',
  },
  {
    id: 'wind-risk', type: 'boolean', points: 5, domain: '起飞安全',
    prompt: '侧向风会造成水平位置偏差，悬停评估时应把环境扰动纳入判断。',
    options: ['正确', '错误'],
    correctAnswers: ['正确'],
    rationale: '环境扰动会影响位置和速度误差，不能只看高度数值判断悬停质量。',
  },
  {
    id: 'scenario-hover', type: 'scenario', points: 25, domain: '情景分析',
    prompt: '标准情境：悬停任务出现明显水平位置偏差，场景存在侧向风扰动。哪种处置最合理？',
    options: ['暂停继续位移，观察位置/速度误差，必要时稳定降落', '立即提高速度并继续前往目标点', '关闭 GPS 和 IMU 以避免读数变化', '忽略偏差，只要高度正确就继续全部任务'],
    correctAnswers: ['暂停继续位移，观察位置/速度误差，必要时稳定降落'],
    rationale: '应先停止扩大风险，结合位置、速度和风扰动判断，必要时降落，而不是带着未解释的偏差继续飞行。',
  },
  {
    id: 'scenario-safety', type: 'scenario', points: 25, domain: '情景分析',
    prompt: '飞行中同时出现 GPS 卫星不足、EKF 不健康或通信心跳过期。你应优先采取什么措施？',
    options: ['暂停依赖定位的任务，保持安全状态并评估返航/降落', '继续发送航点指令，期待系统自行恢复', '关闭故障提示后继续完成考核', '直接把异常记为系统无关并忽略'],
    correctAnswers: ['暂停依赖定位的任务，保持安全状态并评估返航/降落'],
    rationale: '定位、估计器或通信失效会削弱控制和返航可靠性，应优先停止高风险任务并执行安全处置。',
  },
];

export const SCENARIO_QUESTION_VARIANTS = {
  hoverDrift: { ...THEORY_QUESTION_BANK[8]!, id: 'scenario-hover-drift', prompt: '结合本次悬停位置误差记录，若同时存在侧向风，应采取哪种处理方法？' },
  gpsWarning: { ...THEORY_QUESTION_BANK[9]!, id: 'scenario-safety-gps', prompt: '参考本次定位诊断记录，若飞行中再次出现 GPS 卫星不足或 EKF 不健康，应优先如何处理？' },
} satisfies Record<string, ExamQuestion>;
