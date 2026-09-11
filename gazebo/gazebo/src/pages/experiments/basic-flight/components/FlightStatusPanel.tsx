import { Activity } from 'lucide-react';

import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { useTelemetryStore } from '../../../../stores/telemetryStore';
import styles from './Panels.module.css';

export function FlightStatusPanel() {
  const telemetry = useTelemetryStore((state) => state.latest);
  const availability = useTelemetryStore((state) => state.availability);
  const ekfStatus = telemetry?.ekfStatus;
  const mavlinkStatus = telemetry?.mavlinkStatus;
  const statusRows = [
    { label: '飞行模式', value: telemetry?.mode ?? '等待数据', tone: 'primary' },
    { label: 'ARM', value: telemetry ? (telemetry.armed ? 'YES' : 'NO') : '等待数据', tone: 'success' },
    { label: 'ALT', value: telemetry ? `${telemetry.position.altitude.toFixed(1)} m` : '等待数据', tone: 'primary' },
    { label: 'SPEED', value: telemetry ? `${telemetry.speedMetersPerSecond.toFixed(1)} m/s` : '等待数据', tone: 'primary' },
    { label: 'GPS', value: telemetry ? `${telemetry.gpsSatellites}` : '等待数据', tone: 'violet' },
    { label: 'Battery', value: telemetry ? `${telemetry.batteryPercent.toFixed(0)}%` : '等待数据', tone: 'success' },
    { label: 'EKF', value: ekfStatus ? (ekfStatus.healthy ? '正常' : '异常') : '等待数据', tone: 'success' },
    { label: 'MAVLink', value: mavlinkStatus ? (mavlinkStatus.connected && mavlinkStatus.heartbeat ? '已连接' : '断开') : '等待数据', tone: 'success' },
  ] as const;

  return (
    <PanelShell title="飞行状态" icon={Activity} action={<span className={styles.connectedBadge}>{availability === 'LOST' ? 'Telemetry Lost' : availability === 'UNKNOWN' ? '等待数据' : '实时'}</span>} emphasis="secondary">
      <div className={styles.statusList}>
        {statusRows.map(({ label, value, tone }) => (
          <div className={styles.statusRow} key={label}>
            <span>{label}</span>
            <strong className={styles[tone]}>{value}</strong>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}
