import { Activity, AlertTriangle, BookOpenCheck, ChevronRight, Clock3, Cpu, Server, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

import styles from '../platform/PlatformPages.module.css';

const services = [
  ['Web 前端', 'RUNNING', '正常', '刚刚'],
  ['业务 API', 'RUNNING', '正常', '刚刚'],
  ['Gazebo 服务', 'READY', '待分配', '1 分钟前'],
] as const;

export function AdminDashboardPage() {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>系统总览</h1><p>统一查看平台用户、课程、仿真资源与系统运行状态。</p></div>
        <span><Clock3 size={15} />{new Date().toLocaleDateString('zh-CN')} · 管理环境</span>
      </header>

      <div className={styles.dashboardGrid}>
        <section className={`${styles.panel} ${styles.statusPanel}`}>
          <h2><Cpu size={18} />平台与教学资源</h2>
          <div className={styles.statusGrid}>
            <div className={styles.statusCard}><span>平台注册用户</span><strong>586</strong><i>● 今日在线 72</i></div>
            <div className={styles.statusCard}><span>教师 / 学生</span><strong>26 / 560</strong><i>● 账号状态正常</i></div>
            <div className={styles.statusCard}><span>开放课程</span><strong>12 / 18</strong><i>● 本学期运行中</i></div>
            <div className={styles.statusCard}><span>仿真实例</span><strong>8 / 24</strong><i>● 资源充足</i></div>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.currentPanel}`}>
          <h2><ShieldCheck size={18} />当前状态</h2>
          <div className={styles.currentExperiment}>
            <span>PLATFORM HEALTH</span>
            <strong>平台整体运行正常</strong>
            <small>1 条低优先级资源告警 · 暂无教学故障</small>
            <Link className={styles.primaryButton} to="/admin/logs">查看操作日志 <ChevronRight size={15} /></Link>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.recentPanel}`}>
          <h2><Activity size={18} />平台与仿真服务</h2>
          <div className={styles.recordList}>
            {services.map(([name, state, detail, time]) => (
              <Link className={styles.recordItem} to="/admin/resources" key={name}>
                <span><strong>{name}</strong><small>系统服务</small></span>
                <span><small>状态</small><strong>{state}</strong></span>
                <span><small>健康度</small><strong>{detail}</strong></span>
                <span><small>节点</small><strong>MUVA-NODE</strong></span>
                <span><small>检查时间</small><strong>{time}</strong></span>
                <ChevronRight size={16} />
              </Link>
            ))}
          </div>
        </section>

        <section className={`${styles.panel} ${styles.vehiclePanel}`}>
          <h2><Server size={18} />资源状态</h2>
          <div className={styles.metricGrid}>
            <div className={styles.metricCard}><span>CPU 使用率</span><strong>42%</strong></div>
            <div className={styles.metricCard}><span>内存使用率</span><strong>61%</strong></div>
            <div className={styles.metricCard}><span>GPU 使用率</span><strong>37%</strong></div>
            <div className={styles.metricCard}><span>运行实例</span><strong>8 / 24</strong></div>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.alertsPanel}`}>
          <h2><AlertTriangle size={18} />管理快捷入口</h2>
          <div className={styles.alertList}>
            <span className={styles.healthyAlert}><Users size={14} />用户管理：教师、学生与账号状态</span>
            <span className={styles.healthyAlert}><BookOpenCheck size={14} />课程管理：课程、班级与任课教师</span>
            <span className={styles.healthyAlert}><ShieldCheck size={14} />实验管理：可修改教师创建的实验定义</span>
            <span><AlertTriangle size={14} />管理员不可进入学生个人实验记录、轨迹、报告和成绩详情</span>
          </div>
        </section>
      </div>
    </div>
  );
}
