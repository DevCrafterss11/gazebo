import { BatteryMedium, Gauge, Radio } from 'lucide-react';

import type { Drone } from '../../../types/collaboration';
import styles from '../Collaboration.module.css';

const statusLabels = { WAITING: '等待', READY: 'Ready', RUNNING: '执行中', COMPLETE: '完成', FAILED: '异常' } as const;

export function DroneCard({ drone, assigned, selected, onClick }: { drone: Drone; assigned: boolean; selected?: boolean; onClick: () => void }) {
  return <button className={`${styles.droneCard} ${assigned ? styles.droneCardAssigned : ''} ${selected ? styles.droneCardSelected : ''}`} onClick={onClick} type="button">
    <span className={styles.droneGlyph}>✣</span><span className={styles.droneCardCopy}><strong>{drone.name}</strong><small>{drone.model}</small><span><BatteryMedium size={12} />{drone.endurance} min <Gauge size={12} />{drone.speed} m/s</span></span><span className={`${styles.statusPill} ${drone.status === 'FAILED' ? styles.statusDanger : drone.status === 'RUNNING' ? styles.statusRunning : ''}`}><Radio size={11} />{assigned ? '已编组' : statusLabels[drone.status]}</span>
  </button>;
}
