import { Boxes, RadioTower, Route, ShieldAlert, Wrench } from 'lucide-react';
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
  { number: '实验二', title: '集群飞行控制', subtitle: '多机协同', description: '学习多架无人机的连接管理、编队控制与集群安全返航。', path: '/experiments/swarm', status: '建设中', icon: Boxes, plans: ['多机连接', '编队起飞', '队形控制', '集群返航'] },
  { number: '实验三', title: '任务协同', subtitle: '任务规划', description: '围绕航点任务、任务分配和多机协作开展训练。', path: '/experiments/mission', status: '建设中', icon: Route, plans: ['任务规划', '航点分配', '协同执行', '任务复盘'] },
  { number: '实验四', title: '安全攻防对抗', subtitle: '安全训练', description: '识别无人机链路、定位与控制面临的典型安全威胁。', path: '/experiments/security', status: '建设中', icon: ShieldAlert, plans: ['威胁识别', '链路监测', '异常处置', '安全评分'] },
  { number: '实验五', title: '自定义安全对抗', subtitle: '开放实验', description: '按教学目标组合场景、事件与处置策略，构建自定义实验。', path: '/experiments/custom-security', status: '建设中', icon: Wrench, plans: ['场景编排', '事件配置', '策略验证', '实验导出'] },
];
