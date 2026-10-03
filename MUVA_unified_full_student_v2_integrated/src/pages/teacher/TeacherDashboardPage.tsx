import { Activity, AlertTriangle, ChevronRight, Clock3, Gauge, GraduationCap, RadioTower, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

import styles from '../platform/PlatformPages.module.css';

const runningExperiments = [
  ['航点任务规划实验', '软件工程 1 班', '28 / 42', '2 人异常', '14:00-16:00'],
  ['基础飞行控制实验', '软件工程 2 班', '28 / 40', '运行正常', '14:00-16:00'],
  ['PID 参数调节实验', '自动化 1 班', '16 / 38', '运行正常', '15:30-17:00'],
] as const;

export function TeacherDashboardPage() {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>教师工作台</h1><p>统一查看课程教学、实验进度、学生状态与待办事项。</p></div>
        <span><Clock3 size={15} />{new Date().toLocaleDateString('zh-CN')} · 第 3 教学周</span>
      </header>

      <div className={styles.dashboardGrid}>
        <section className={`${styles.panel} ${styles.statusPanel}`}>
          <h2><GraduationCap size={18} />教学概览</h2>
          <div className={styles.statusGrid}>
            <div className={styles.statusCard}><span>我的课程</span><strong>3</strong><i>● 3 个教学班</i></div>
            <div className={styles.statusCard}><span>学生人数</span><strong>126</strong><i>● 今日在线 72</i></div>
            <div className={styles.statusCard}><span>进行中实验</span><strong>2</strong><i>● 56 人正在实验</i></div>
            <div className={styles.statusCard}><span>待批改报告</span><strong>18</strong><i className={styles.waiting}>● 等待处理</i></div>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.currentPanel}`}>
          <h2><Gauge size={18} />当前待办</h2>
          <div className={styles.currentExperiment}>
            <span>PRIORITY 1 / 3</span>
            <strong>航点任务规划实验</strong>
            <small>软件工程 1 班 · 28 / 42 已开始 · 2 人异常</small>
            <Link className={styles.primaryButton} to="/teacher/monitor">进入实验监控 <ChevronRight size={15} /></Link>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.recentPanel}`}>
          <h2><Activity size={18} />进行中实验</h2>
          <div className={styles.recordList}>
            {runningExperiments.map(([name, className, started, state, time]) => (
              <Link className={styles.recordItem} to="/teacher/monitor" key={name}>
                <span><strong>{name}</strong><small>无人机飞行控制</small></span>
                <span><small>教学班</small><strong>{className}</strong></span>
                <span><small>已开始</small><strong>{started}</strong></span>
                <span><small>状态</small><strong>{state}</strong></span>
                <span><small>时间</small><strong>{time}</strong></span>
                <ChevronRight size={16} />
              </Link>
            ))}
          </div>
        </section>

        <section className={`${styles.panel} ${styles.vehiclePanel}`}>
          <h2><RadioTower size={18} />教学状态</h2>
          <div className={styles.metricGrid}>
            <div className={styles.metricCard}><span>基础飞行完成率</span><strong>92%</strong></div>
            <div className={styles.metricCard}><span>航点规划完成率</span><strong>78%</strong></div>
            <div className={styles.metricCard}><span>PID 调节完成率</span><strong>65%</strong></div>
            <div className={styles.metricCard}><span>本周平均成绩</span><strong>86.4</strong></div>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.alertsPanel}`}>
          <h2><AlertTriangle size={18} />最近异常</h2>
          <div className={styles.alertList}>
            <span><AlertTriangle size={14} />王五 · GPS 信号异常，实验已暂停</span>
            <span><AlertTriangle size={14} />李四 · 飞行高度超过实验限制 20m</span>
            <span><AlertTriangle size={14} />赵六 · 实验剩余时间不足 5 分钟</span>
            <span className={styles.healthyAlert}><Users size={14} />其余学生实验状态正常</span>
          </div>
        </section>
      </div>
    </div>
  );
}
