import { Activity, Battery, Crosshair, Gauge, Navigation, RadioTower, Satellite } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { EmptyState } from '../../components/common/EmptyState/EmptyState';
import { PanelShell } from '../../components/common/PanelShell/PanelShell';
import { FlightControlSurface } from '../../components/flight/FlightControlSurface';
import { FlightSceneViewport } from '../../components/map/FlightSceneViewport';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { useFlightStore } from '../../stores/flightStore';
import { useTelemetryStore } from '../../stores/telemetryStore';
import { MavlinkMonitorPanel } from './MavlinkMonitorPanel';
import styles from './PlatformPages.module.css';

export function FlightPage() {
  const runtime = useEnvironmentStore((state) => state.runtime);
  const status = useFlightStore((state) => state.status);
  const flightPath = useTelemetryStore((state) => state.flightPath);
  const mapHome = useTelemetryStore((state) => state.mapHome);
  const latest = useTelemetryStore((state) => state.latest);
  const telemetryAvailability = useTelemetryStore((state) => state.availability);
  const connect = useTelemetryStore((state) => state.connect);
  const environmentReady = runtime.vehicle === 'ONLINE';
  const ready = environmentReady && telemetryAvailability === 'AVAILABLE';

  useEffect(() => {
    if (environmentReady) connect();
  }, [connect, environmentReady]);

  return (
    <div className={`${styles.page} ${styles.flightPage}`}>
      <header className={styles.pageHeader}>
        <div><h1>实时飞控</h1><p>读取实验一共享的飞行状态，不创建第二套无人机或遥测数据。</p></div>
        <span><RadioTower size={16} />{ready ? 'VEHICLE ONLINE' : 'ENVIRONMENT OFFLINE'}</span>
      </header>
      {!ready ? (
        <EmptyState icon={RadioTower} title={environmentReady ? 'Telemetry Lost' : '当前没有已启动的仿真实验'} description={environmentReady ? '遥测数据暂不可用，飞行控制已锁定，请等待连接恢复。' : '请先进入实验一，完成配置、起飞前检查并启动仿真环境。'} action={<Link to="/experiments/basic-flight">进入实验一</Link>} />
      ) : (
        <div className={styles.flightGrid}>
          <section className={styles.flightView}>
        <PanelShell title="实时飞行视图" icon={Crosshair} action={<span>共享飞行状态</span>} emphasis="primary">
              <FlightSceneViewport altitudeMeters={status.position.altitude} armed={status.armed} speedMetersPerSecond={status.groundSpeed} currentTask="实时飞控" latitude={status.position.latitude} longitude={status.position.longitude} home={mapHome ?? status.homePosition} north={status.north} east={status.east} yaw={status.yaw} mode={status.mode} flightPath={flightPath} />
            </PanelShell>
          </section>
          <section className={styles.panel}>
            <h2><Activity size={18} />无人机状态</h2>
            <div className={styles.metricGrid}>
              <div className={styles.metricCard}><span>ARM</span><strong>{latest?.armed ? 'ARMED' : 'DISARMED'}</strong></div>
              <div className={styles.metricCard}><span>MODE</span><strong>{latest?.mode ?? status.mode}</strong></div>
              <div className={styles.metricCard}><span><Gauge size={12} /> ALT</span><strong>{latest?.position.altitude.toFixed(1) ?? status.position.altitude.toFixed(1)} m</strong></div>
              <div className={styles.metricCard}><span><Navigation size={12} /> SPEED</span><strong>{latest?.speedMetersPerSecond.toFixed(1) ?? status.groundSpeed.toFixed(1)} m/s</strong></div>
              <div className={styles.metricCard}><span><Satellite size={12} /> GPS</span><strong>{latest?.gpsSatellites ?? status.gpsSatellites} sats</strong></div>
              <div className={styles.metricCard}><span><Battery size={12} /> Battery</span><strong>{latest?.batteryPercent.toFixed(0) ?? status.batteryPercent.toFixed(0)}%</strong></div>
              <div className={styles.metricCard}><span>EKF</span><strong>{latest?.ekfStatus.healthy ? 'HEALTHY' : 'UNHEALTHY'}</strong></div>
              <div className={styles.metricCard}><span>MAVLink</span><strong>{latest?.mavlinkStatus.connected && latest.mavlinkStatus.heartbeat ? 'CONNECTED' : 'DISCONNECTED'}</strong></div>
            </div>
          </section>
          <section className={styles.flightControls}>
            <PanelShell title="基础飞行控制" icon={RadioTower} action={<span>ARM · TAKEOFF · HOLD · RTL · LAND</span>} emphasis="secondary">
              <FlightControlSurface />
            </PanelShell>
          </section>
          <section className={styles.mavlinkMonitor}>
            <MavlinkMonitorPanel />
          </section>
        </div>
      )}
    </div>
  );
}
