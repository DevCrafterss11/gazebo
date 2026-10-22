import { Info, PackageOpen, UserRoundCheck } from 'lucide-react';

import type { Mission } from '../../types/collaboration';
import { useCollaborationStore } from '../../stores/collaborationStore';
import { DroneCard } from './components/DroneCard';
import { TaskGroupTree } from './components/TaskGroupTree';
import styles from './Collaboration.module.css';

export function DroneGroupConfig({ mission }: { mission: Mission }) {
  const selectedGroup = useCollaborationStore((state) => state.selectedTaskGroup);
  const selectedDrone = useCollaborationStore((state) => state.selectedDrone);
  const selectGroup = useCollaborationStore((state) => state.selectTaskGroup);
  const selectDrone = useCollaborationStore((state) => state.selectDrone);
  const assignDrone = useCollaborationStore((state) => state.assignDrone);
  const group = mission.groups.find((item) => item.id === selectedGroup) ?? mission.groups[0];
  return <div className={styles.stepPage}><div className={styles.configGrid}><section className={styles.panel}><div className={styles.panelTitle}><span className={styles.titleIcon}><PackageOpen size={17} /></span><div><strong>任务组树</strong><small>先选择需要配置的任务</small></div></div><TaskGroupTree groups={mission.groups} selectedId={selectedGroup} onSelect={selectGroup} /><div className={styles.assignmentHint}><Info size={15} /><span>每个任务组配置 3 架无人机。选择任务组后，在右侧资源池中点击无人机加入或移除。</span></div></section><section className={`${styles.panel} ${styles.resourcePanel}`}><div className={styles.panelTitle}><span className={styles.titleIcon}><UserRoundCheck size={17} /></span><div><strong>无人机资源池</strong><small>{group?.name} · 已选 {group?.drones.length ?? 0}/3</small></div><span className={styles.panelStatus}>{group?.drones.length === 3 ? '配置完成' : '待补充'}</span></div><div className={styles.resourceToolbar}><span>可用资源 / 15 架</span><small>点击卡片完成任务编组</small></div><div className={styles.droneGrid}>{mission.drones.map((drone) => <DroneCard drone={drone} assigned={group?.drones.includes(drone.id) ?? false} selected={selectedDrone === drone.id} onClick={() => { selectDrone(drone.id); assignDrone(drone.id); }} key={drone.id} />)}</div><div className={styles.assignmentFooter}><span><b>{group?.name}</b> 当前编组：{group?.drones.join(' · ') || '尚未选择'}</span><span className={group?.drones.length === 3 ? styles.readyText : styles.warningText}>{group?.drones.length === 3 ? '✓ 可进入协同方案配置' : '还需要配置满 3 架'}</span></div></section></div></div>;
}
