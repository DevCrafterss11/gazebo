import { Activity, AlertTriangle, Battery, ChevronRight, Clock3, Cpu, Gauge, RadioTower } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useEnvironmentStore } from '../../stores/environmentStore';
import { useExperimentStore } from '../../stores/experimentStore';
import { useFlightStore } from '../../stores/flightStore';
import { useRecordsStore } from '../../stores/recordsStore';
import styles from './PlatformPages.module.css';

const healthyRuntimeValues = new Set(['RUNNING', 'CONNECTED', 'OK', '3D FIX', 'HEALTHY', 'READY']);

export function DashboardPage() {
  const runtime = useEnvironmentStore((state) => state.runtime);
  const startup = useEnvironmentStore((state) => state.startup);
  const experiment = useExperimentStore((state) => state.experiment);
  const session = useExperimentStore((state) => state.session);
  const selectedDrone = useExperimentStore((state) => state.selectedDrone);
  const flight = useFlightStore((state) => state.status);
  const telemetryAvailability = useFlightStore((state) => state.telemetryAvailability);
  const records = useRecordsStore((state) => state.records);

  const runtimeCards = [
    ['平台状态', '运行中', 'READY'],
    ['Gazebo', runtime.gazebo, runtime.gazebo],
    ['ArduPilot SITL', runtime.ardupilotSitl, runtime.ardupilotSitl],
    ['MAVLink Gateway', runtime.mavlinkGateway, runtime.mavlinkGateway],
  ] as const;
  const alerts = [
    ...(runtime.gazebo === 'STOPPED' ? ['当前没有已启动的仿真实验'] : []),
    ...(flight.batteryPercent < 25 ? [`无人机电量偏低：${flight.batteryPercent.toFixed(0)}%`] : []),
    ...(runtime.ekf !== 'HEALTHY' && runtime.gazebo === 'RUNNING' ? ['EKF 尚未进入健康状态'] : []),
  ];

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>平台总览</h1><p>统一查看实验进度、仿真环境、无人机状态和最近训练结果。</p></div>
        <span><Clock3 size={15} />{new Date().toLocaleDateString('zh-CN')} · 仿真教学环境</span>
      </header>
      <div className={styles.dashboardGrid}>
        <section className={`${styles.panel} ${styles.statusPanel}`}>
          <h2><Cpu size={18} />平台与仿真服务</h2>
          <div className={styles.statusGrid}>
            {runtimeCards.map(([label, value, status]) => (
              <div className={styles.statusCard} key={label}>
                <span>{label}</span><strong>{value}</strong>
                <i className={healthyRuntimeValues.has(status) ? '' : styles.waiting}>{healthyRuntimeValues.has(status) ? '● 服务正常' : '● 等待启动'}</i>
              </div>
            ))}
          </div>
        </section>
        <section className={`${styles.panel} ${styles.currentPanel}`}>
          <h2><Gauge size={18} />当前实验</h2>
          <div className={styles.currentExperiment}>
            <span>{session ? session.status : `STEP ${experiment.currentStep} / 8`}</span>
            <strong>{experiment.title}</strong>
            <small>{startup.message} · {startup.progress}%</small>
            <Link className={styles.primaryButton} to="/experiments/basic-flight">继续实验 <ChevronRight size={15} /></Link>
          </div>
        </section>
        <section className={`${styles.panel} ${styles.recentPanel}`}>
          <h2><Activity size={18} />最近实验</h2>
          <div className={styles.recordList}>
            {records.length === 0 ? (
              <div className={styles.alertList}><span>尚无已完成实验，完成实验一后将在这里生成记录。</span></div>
            ) : records.slice(0, 3).map((record) => (
              <Link className={styles.recordItem} to={`/records/${record.id}`} key={record.id}>
                <span><strong>{record.session.name}</strong><small>{record.id}</small></span>
                <span><small>无人机</small><strong>{record.session.drone.name}</strong></span>
                <span><small>场景</small><strong>{record.session.scene.name}</strong></span>
                <span><small>状态</small><strong>{record.session.status}</strong></span>
                <span><small>得分</small><strong>{record.result.score}</strong></span>
                <ChevronRight size={16} />
              </Link>
            ))}
          </div>
        </section>
        <section className={`${styles.panel} ${styles.vehiclePanel}`}>
          <h2><RadioTower size={18} />无人机状态</h2>
          <div className={styles.metricGrid}>
            <div className={styles.metricCard}><span>机型</span><strong>{selectedDrone?.name ?? '未选择'}</strong></div>
            <div className={styles.metricCard}><span>飞行模式</span><strong>{telemetryAvailability === 'AVAILABLE' ? flight.mode : '等待数据'}</strong></div>
            <div className={styles.metricCard}><span>ARM</span><strong>{flight.armed ? 'ARMED' : 'DISARMED'}</strong></div>
            <div className={styles.metricCard}><span>Battery</span><strong><Battery size={13} /> {telemetryAvailability === 'AVAILABLE' ? `${flight.batteryPercent.toFixed(0)}%` : '等待数据'}</strong></div>
          </div>
        </section>
        <section className={`${styles.panel} ${styles.alertsPanel}`}>
          <h2><AlertTriangle size={18} />当前告警</h2>
          <div className={styles.alertList}>
            {alerts.length > 0 ? alerts.map((alert) => <span key={alert}><AlertTriangle size={14} />{alert}</span>) : <span className={styles.healthyAlert}><Activity size={14} />当前没有活动告警，仿真与飞行状态正常。</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
