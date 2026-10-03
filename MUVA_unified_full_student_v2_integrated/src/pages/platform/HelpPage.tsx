import { BookOpen, CircleHelp } from 'lucide-react';
import { useState } from 'react';

import styles from './PlatformPages.module.css';

const helpSections = [
  { title: '实验一说明', paragraphs: ['实验一包含无人机选择、实验参数配置、场景配置、启动仿真环境、飞控与传感器检查、起飞前检查、基础飞行训练和实验结果八个步骤。', '环境 READY、系统检查 PASSED、Preflight PASSED 是进入后续训练步骤的硬性条件。'] },
  { title: '基础飞行训练说明', paragraphs: ['请按顺序执行 ARM、TAKEOFF、悬停、升降、水平移动、偏航、RTL 与 LAND。', '训练引擎持续读取同一份遥测数据，并根据完成条件推进任务、计算评分和记录安全事件。'] },
  { title: 'ArduPilot 基础概念', paragraphs: ['ArduPilot Copter 是多旋翼飞行控制软件。当前教学环境在浏览器中演示 SITL、MAVLink Gateway 和飞行状态演进。', '浏览器不处理 MAVLink 二进制；未来真实模式由后端 Gateway 转换为 REST 与 WebSocket JSON。'] },
  { title: '飞行模式说明', paragraphs: ['GUIDED：按外部指令执行位置与高度控制。STABILIZE：人工姿态稳定模式。LOITER：保持当前位置与高度。', 'RTL：返回 Home Point。LAND：按安全速率下降并在接地后自动上锁。'] },
  { title: '操作安全说明', paragraphs: ['起飞前确认 GPS、EKF、MAVLink 和传感器状态正常。飞行中不要直接 DISARM，优先使用 LAND。', '遇到位置偏差或任务异常时可使用 HOLD 稳定飞行器，再选择 RTL 或 LAND。'] },
] as const;

export function HelpPage() {
  const [selectedTitle, setSelectedTitle] = useState<string>(helpSections[0]!.title);
  const selected = helpSections.find((section) => section.title === selectedTitle) ?? helpSections[0]!;
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>帮助文档</h1><p>本地静态教学内容，无需连接后端即可阅读。</p></div>
        <span><CircleHelp size={16} />MUVA 使用指南</span>
      </header>
      <div className={styles.helpGrid}>
        <nav className={`${styles.panel} ${styles.helpNav}`} aria-label="帮助文档章节">
          {helpSections.map((section) => <button className={section.title === selected.title ? styles.selectedHelp : ''} type="button" aria-current={section.title === selected.title ? 'page' : undefined} disabled={section.title === selected.title} onClick={() => setSelectedTitle(section.title)} key={section.title}>{section.title}</button>)}
        </nav>
        <article className={`${styles.panel} ${styles.helpContent}`}>
          <h2><BookOpen size={18} />{selected.title}</h2>
          {selected.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <ul>
            <li>所有飞行命令都有状态反馈，条件不满足时会显示明确原因。</li>
            <li>顶部环境状态和 Sidebar 底部状态卡均可打开统一环境详情。</li>
            <li>完成实验后可在记录、分析和报告页面查看同一 Session 数据。</li>
          </ul>
        </article>
      </div>
    </div>
  );
}
