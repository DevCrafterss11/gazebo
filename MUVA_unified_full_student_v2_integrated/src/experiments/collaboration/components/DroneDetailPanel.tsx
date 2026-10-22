import { Activity, BatteryCharging, MapPin, Move3d, Navigation } from 'lucide-react';

import type { Drone } from '../../../types/collaboration';
import styles from '../Collaboration.module.css';

const statusLabels = { WAITING: '等待执行', READY: 'Ready', RUNNING: '协同执行中', COMPLETE: '任务完成', FAILED: '异常待处理' } as const;

export function DroneDetailPanel({ drone }: { drone?: Drone }) {
  if (!drone) return <div className={styles.emptyDetail}><Move3d size={28} /><strong>点击地图中的无人机</strong><span>查看位置、飞行状态和任务进度</span></div>;
  return <div className={styles.droneDetail}>
    <div className={styles.detailTitle}><span className={styles.droneGlyph}>✣</span><div><strong>{drone.name}</strong><small>{drone.model} · {statusLabels[drone.status]}</small></div><span className={styles.detailLive}>LIVE</span></div>
    <div className={styles.detailMetrics}><div><MapPin size={15} /><small>位置</small><b>({drone.position.x.toFixed(1)}, {drone.position.y.toFixed(1)})</b></div><div><Navigation size={15} /><small>高度</small><b>{drone.position.z.toFixed(1)} m</b></div><div><Activity size={15} /><small>速度</small><b>{drone.speed.toFixed(1)} m/s</b></div><div><BatteryCharging size={15} /><small>电量</small><b>{drone.battery.toFixed(0)}%</b></div></div>
    <div className={styles.detailBar}><span><i style={{ width: `${drone.battery}%` }} /></span><small>剩余续航约 {Math.max(0, Math.round(drone.endurance * drone.battery / 100))} min</small></div>
  </div>;
}
