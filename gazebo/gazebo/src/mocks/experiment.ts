import type { ExperimentDefinition, TrainingScore } from '../types/experiment';

const stepTitles = [
  '无人机选择',
  '实验参数配置',
  '场景配置',
  '启动仿真环境',
  '飞控与传感器检查',
  '起飞前检查',
  '基础飞行训练',
  '实验结果',
] as const;

const taskTitles = [
  'ARM',
  '起飞',
  '悬停 10 秒',
  '上升至 15m',
  '下降至 8m',
  '前进 20m',
  '右移 15m',
  '偏航 90°',
  '执行返航',
  '安全降落',
] as const;

export const mockExperiment: ExperimentDefinition = {
  id: 'experiment-1-basic-flight',
  title: '实验一：无人机配置与基础飞行操作',
  subtitle: '通过模拟实验环境，完成无人机配置、起飞与基础飞行安全降落，掌握多旋翼无人机的基本操作技能。',
  currentStep: 1,
  steps: stepTitles.map((title, index) => ({
    id: index + 1,
    title,
    status: index === 0 ? 'active' : 'pending',
  })),
  tasks: taskTitles.map((title, index) => ({
    id: index + 1,
    title,
    status: index === 0 ? 'PENDING' : 'LOCKED',
    goal: '基础飞行训练',
    completionCondition: '由 TrainingEngine 根据遥测判断',
    progress: 0,
  })),
};

export const mockTrainingScore: TrainingScore = {
  score: 88,
  maximumScore: 100,
  progressPercent: 62,
  completedTasks: 5,
  totalTasks: 10,
  feedback: ['飞行姿态稳定', '高度控制良好', '按计划执行任务', '继续完成后续任务'],
};
