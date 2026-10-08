import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAssessmentStore } from '../../../stores/assessmentStore';
import { FlightCanvas } from './FlightCanvas';
import styles from './AssessmentPage.module.css';
import { services } from '../../../services/serviceRegistry';

export function RealAssessmentPage() {
  const { observing, observerError, observedSample, observedFlight, connectObserver, disconnectObserver } = useAssessmentStore();
  const [clock, setClock] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setClock((value) => value + 1), 500); return () => window.clearInterval(timer); }, []);
  useEffect(() => () => disconnectObserver(), [disconnectObserver]);
  const connected = clock >= 0 && observing && observedFlight !== null && services.assessmentAdapter.isFresh();
  return <main className={styles.page}>
    <header className={styles.header}><div><Link to="/experiments">← 实验中心</Link><h1>实验三：四旋翼无人机系统认知与综合飞行考核</h1><p>真实 MAVLink Gateway 契约验证 · 只读观测，禁止接管其他实验飞控</p></div><strong className={styles.mockBadge}>REAL · 只读安全模式</strong></header>
    <nav className={styles.steps} aria-label="实验三步骤">{['系统认知','飞行参数配置','训练场景选择','仿真环境启动','飞控与传感器诊断','起飞前安全检查','综合飞行考核','实验结果与复盘'].map((name, index) => <button key={name} disabled>{index + 1} · {name}</button>)}</nav>
    <div className={styles.flow} role="status">后端没有跨实验资源租约；真实环境启动、World 切换、解锁、起飞、飞行控制与成绩结算不可用。切回 Mock 模式可体验完整八步实验。观察到的遥测不计入 Mock 成绩。</div>
    <div className={styles.columns}><section className={styles.panel}><h2>Gateway 契约状态</h2><p>连接仅请求网关健康检查、已有飞控快照及遥测 WebSocket。不发送 /runtime/start 或任何控制请求。</p><div className={styles.metric}><span>遥测</span><strong className={connected ? styles.success : styles.warning}>{connected ? '心跳有效 · 可观测' : 'UNKNOWN / STALE'}</strong></div><div className={styles.metric}><span>Home 点</span><strong>{observedFlight ? '已校验' : '未验证'}</strong></div><div className={styles.toolbar}><button className={styles.primary} disabled={observing} onClick={() => void connectObserver()}>连接只读遥测</button><button disabled={!observing} onClick={disconnectObserver}>断开观测</button></div>{observerError && <div className={styles.error} role="alert">{observerError}</div>}</section>
      <section className={`${styles.panel} ${styles.mainPanel}`}><h2>观测机体 · 实测位置与姿态</h2><div className={styles.canvas}>{connected && observedFlight ? <FlightCanvas flight={observedFlight} scene="runway"/> : <div className={styles.emptyCanvas}>等待有效心跳、遥测和真实 Home 点；不会显示虚构无人机位置</div>}</div></section>
      <section className={styles.panel}><h2>真实遥测（只读）</h2>{observedSample && connected ? <>{[['高度', `${observedSample.position.altitude.toFixed(2)} m`], ['水平速度', `${observedSample.speedMetersPerSecond.toFixed(2)} m/s`], ['GPS 卫星', String(observedSample.gpsSatellites)], ['EKF', observedSample.ekfStatus.state], ['模式', observedSample.mode ?? 'UNKNOWN'], ['电量', `${observedSample.batteryPercent.toFixed(0)}%`], ['解锁', observedSample.armed ? '是' : '否'], ['时间戳', new Date(observedSample.timestamp).toLocaleTimeString()]].map(([name, value]) => <div className={styles.metric} key={name}><span>{name}</span><strong>{value}</strong></div>)}</> : <p>网关在线不等于飞控在线；缺失或过期数据均显示 UNKNOWN。</p>}<h3>安全边界</h3><p>当前网关 `/api/v1/runtime/start` 不能启动独立 Gazebo/SITL，且未提供实验所有权租约。正式真实考核须待后端提供资源隔离能力后才能启用。</p></section></div>
  </main>;
}
