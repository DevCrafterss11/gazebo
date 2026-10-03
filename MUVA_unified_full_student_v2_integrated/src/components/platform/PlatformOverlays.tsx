import { Activity, CheckCircle2, CircleDot, Construction, RadioTower } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useEnvironmentStore } from '../../stores/environmentStore';
import { useExperimentStore } from '../../stores/experimentStore';
import { usePlatformUiStore } from '../../stores/platformUiStore';
import { useTelemetryStore } from '../../stores/telemetryStore';
import { ConfirmDialog } from '../common/ConfirmDialog/ConfirmDialog';
import { Modal } from '../common/Modal/Modal';
import styles from './PlatformOverlays.module.css';

const statusTone = (value: string): 'healthy' | 'waiting' => (
  value === 'RUNNING' || value === 'CONNECTED' || value === 'OK' || value === '3D FIX' || value === 'HEALTHY' || value === 'ONLINE' || value === 'READY'
    ? 'healthy'
    : 'waiting'
);

export function PlatformOverlays() {
  const navigate = useNavigate();
  const environmentOpen = usePlatformUiStore((state) => state.environmentOpen);
  const comingSoon = usePlatformUiStore((state) => state.comingSoon);
  const toasts = usePlatformUiStore((state) => state.toasts);
  const closeEnvironment = usePlatformUiStore((state) => state.closeEnvironment);
  const closeComingSoon = usePlatformUiStore((state) => state.closeComingSoon);
  const dismissToast = usePlatformUiStore((state) => state.dismissToast);
  const runtime = useEnvironmentStore((state) => state.runtime);
  const startup = useEnvironmentStore((state) => state.startup);
  const stopEnvironment = useEnvironmentStore((state) => state.stop);
  const isStarting = useEnvironmentStore((state) => state.isStarting);
  const session = useExperimentStore((state) => state.session);
  const markSimulationStopped = useExperimentStore((state) => state.markSimulationStopped);
  const connectionState = useTelemetryStore((state) => state.connectionState);
  const latest = useTelemetryStore((state) => state.latest);
  const [confirmingStop, setConfirmingStop] = useState(false);

  const runtimeRows = [
    ['Gazebo', runtime.gazebo],
    ['ArduPilot SITL', runtime.ardupilotSitl],
    ['MAVLink Gateway', runtime.mavlinkGateway],
    ['Heartbeat', runtime.heartbeat],
    ['GPS', runtime.gps],
    ['EKF', runtime.ekf],
    ['Vehicle', runtime.vehicle],
  ] as const;

  return (
    <>
      {environmentOpen ? (
        <Modal
          title="仿真环境状态"
          description="状态来自当前 EnvironmentService、实验 Session 与实时遥测连接。"
          onClose={() => { setConfirmingStop(false); closeEnvironment(); }}
          width="wide"
        >
          <div className={styles.environmentSummary}>
            <div>
              <Activity size={18} />
              <span>启动阶段</span>
              <strong>{startup.message}</strong>
              <small>{startup.progress}%</small>
            </div>
            <div>
              <RadioTower size={18} />
              <span>遥测连接</span>
              <strong>{connectionState.toUpperCase()}</strong>
              <small>{latest ? new Date(latest.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '暂无采样'}</small>
            </div>
          </div>
          <div className={styles.runtimeList}>
            {runtimeRows.map(([label, value]) => (
              <div key={label}>
                <span className={styles[statusTone(value)]}><CircleDot size={12} />{value}</span>
                <strong>{label}</strong>
              </div>
            ))}
          </div>
          <div className={styles.sessionLine}>
            <span>当前实验 Session</span>
            <strong>{session ? `${session.id} · ${session.status}` : '尚未创建'}</strong>
          </div>
          <div className={styles.modalActions}>
            <button type="button" onClick={() => { closeEnvironment(); navigate('/flight'); }}>查看详细状态</button>
            <button type="button" disabled={runtime.gazebo === 'STOPPED' || isStarting} title={runtime.gazebo === 'STOPPED' ? '仿真环境当前未运行' : undefined} onClick={() => setConfirmingStop(true)}>停止仿真环境</button>
          </div>
        </Modal>
      ) : null}
      {confirmingStop ? (
        <ConfirmDialog
          title="停止仿真环境"
          description="遥测连接会同步断开，当前飞行控制将不可用。"
          onCancel={() => setConfirmingStop(false)}
          onConfirm={async () => { await stopEnvironment().then(markSimulationStopped); setConfirmingStop(false); closeEnvironment(); }}
          confirmLabel="确认停止"
        />
      ) : null}
      {comingSoon ? (
        <Modal title="功能建设中" description={comingSoon.title} onClose={closeComingSoon} width="compact">
          <div className={styles.comingSoon}>
            <Construction size={38} />
            <p>{comingSoon.description}</p>
            <button type="button" onClick={closeComingSoon}>我知道了</button>
          </div>
        </Modal>
      ) : null}
      <div className={styles.toastRegion} aria-live="polite" aria-label="操作反馈">
        {toasts.map((toast) => (
          <button className={`${styles.toast} ${styles[toast.tone]}`} type="button" key={toast.id} onClick={() => dismissToast(toast.id)}>
            <CheckCircle2 size={17} />
            <span>{toast.message}</span>
          </button>
        ))}
      </div>
    </>
  );
}
