import type { SetupStepDefinition } from '../types/experiment';

export const mockSetupSteps: SetupStepDefinition[] = [
  {
    stepId: 2,
    title: '实验参数配置',
    description: '统一配置 ArduPilot 飞控、MAVLink 与基础飞行参数。',
    options: [
      { id: 'firmware', label: '飞控固件', value: 'ArduPilot Copter 4.6.2', status: 'ready' },
      { id: 'frame', label: '机架类型', value: 'Quad X', status: 'recommended' },
      { id: 'mode', label: '默认模式', value: 'GUIDED', status: 'normal' },
      { id: 'link', label: '通信协议', value: 'MAVLink 2', status: 'ready' },
    ],
    checklist: ['飞控参数完整', 'MAVLink 版本已选择', '飞行参数校验通过'],
  },
  {
    stepId: 3,
    title: '场景配置',
    description: '选择 Gazebo World 并设置 Home Position。',
    options: [
      { id: 'campus', label: '校园环境', value: '推荐', status: 'recommended' },
      { id: 'training', label: '标准训练场', value: '标准航线', status: 'ready' },
      { id: 'open', label: '空旷环境', value: '低障碍', status: 'normal' },
      { id: 'home', label: 'Home Position', value: '经纬度与海拔', status: 'ready' },
    ],
    checklist: ['场景已选择', 'Home Position 已设置', 'ExperimentConfig 完整'],
  },
  {
    stepId: 4,
    title: '启动仿真环境',
    description: '创建实验并依次启动 Gazebo、SITL 与 MAVLink Gateway。',
    options: [
      { id: 'gazebo', label: 'Gazebo', value: 'RUNNING', status: 'ready' },
      { id: 'sitl', label: 'ArduPilot SITL', value: 'RUNNING', status: 'ready' },
      { id: 'mavlink', label: 'MAVLink Gateway', value: 'CONNECTED', status: 'ready' },
      { id: 'vehicle', label: 'Vehicle', value: 'ONLINE', status: 'ready' },
    ],
    checklist: ['Heartbeat OK', 'Vehicle ONLINE', 'Environment READY'],
  },
  {
    stepId: 5,
    title: '飞控与传感器检查',
    description: '检查飞控连接及模拟传感器健康状态，不执行硬件校准。',
    options: [
      { id: 'heartbeat', label: 'Heartbeat', value: 'PASS', status: 'ready' },
      { id: 'gps', label: 'GPS', value: '3D Fix · 16 星', status: 'ready' },
      { id: 'imu', label: 'IMU / Compass', value: 'Healthy', status: 'ready' },
      { id: 'ekf', label: 'Barometer / EKF', value: 'Healthy', status: 'ready' },
    ],
    checklist: ['Heartbeat 与 GPS 通过', '惯导与罗盘健康', 'EKF 健康'],
  },
  {
    stepId: 6,
    title: '起飞前检查',
    description: '逐项完成 Preflight Checklist，通过后进入基础飞行训练。',
    options: [
      { id: 'sitl', label: 'ArduPilot SITL', value: '运行中', status: 'ready' },
      { id: 'gazebo', label: 'Gazebo', value: '场景已加载', status: 'ready' },
      { id: 'mavlink', label: 'MAVLink', value: '已连接', status: 'ready' },
      { id: 'vehicle', label: 'Iris 四旋翼', value: '可解锁', status: 'ready' },
    ],
    checklist: ['环境与连接 READY', '传感器及 EKF 健康', '飞行器保持 DISARMED'],
  },
];
