import { Boxes, Network, RadioTower, ShieldAlert, Wrench } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface ExperimentCatalogItem {
  number: string;
  title: string;
  subtitle: string;
  description: string;
  path: string;
  status: '可开始' | '建设中';
  icon: LucideIcon;
  plans: string[];
}

export const experimentCatalog: ExperimentCatalogItem[] = [
  { number: '实验一', title: '无人机配置与基础飞行操作', subtitle: '基础飞行', description: '完成实验配置、仿真环境启动、系统检查、基础飞行任务和训练评分。', path: '/experiments/basic-flight', status: '可开始', icon: RadioTower, plans: ['无人机选择', '环境启动与检查', '基础飞行训练', '实验评分'] },
  { number: '实验二', title: '多无人机集群区域规划与协同飞行', subtitle: '多机协同', description: '配置 2–6 架无人机、绘制区域、规划覆盖航线并完成协同巡航与复盘。', path: '/experiments/swarm', status: '可开始', icon: Boxes, plans: ['机群配置', '区域规划', '航线分配', '预飞检查', '协同飞行', '实验结果'] },
  { number: '实验三', title: '多无人机任务协同实验', subtitle: '任务协同', description: '完成任务编组、角色分工、协同执行、异常处置与实验评价。', path: '/experiments/collaboration', status: '可开始', icon: Network, plans: ['任务认知', '任务编组', '方案配置', '执行监控', '异常处理', '结果评价'] },
  { number: '实验四', title: '安全攻防对抗', subtitle: '安全训练', description: '在隔离的实验遥测通道中识别重放与链路退化并验证恢复。', path: '/experiments/security', status: '可开始', icon: ShieldAlert, plans: ['威胁识别', '链路监测', '异常处置', '安全评分'] },
  { number: '实验五', title: '自定义安全对抗', subtitle: '开放实验', description: '按教学目标组合场景、事件与处置策略，构建自定义实验。', path: '/experiments/custom-security', status: '可开始', icon: Wrench, plans: ['实验目标', '场景编排', '事件配置', '策略配置', '对照验证', '复盘评分'] },
];
