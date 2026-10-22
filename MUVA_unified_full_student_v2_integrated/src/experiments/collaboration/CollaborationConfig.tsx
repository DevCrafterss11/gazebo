import { Crown, GitBranch, Repeat2, UsersRound } from 'lucide-react';

import { useCollaborationStore } from '../../stores/collaborationStore';
import type { CollaborationMode, Mission } from '../../types/collaboration';
import { collaborationModeLabels } from '../../types/collaboration';
import { TaskGroupTree } from './components/TaskGroupTree';
import styles from './Collaboration.module.css';

const modeIcons: Record<CollaborationMode, typeof Repeat2> = { SYNC: Repeat2, RELAY: GitBranch, LEADER: Crown };

export function CollaborationConfig({ mission }: { mission: Mission }) {
  const selectedGroupId = useCollaborationStore((state) => state.selectedTaskGroup);
  const selectGroup = useCollaborationStore((state) => state.selectTaskGroup);
  const setMode = useCollaborationStore((state) => state.setMode);
  const group = mission.groups.find((item) => item.id === selectedGroupId) ?? mission.groups[0];
  return <div className={styles.stepPage}><div className={styles.configGrid}><section className={styles.panel}><div className={styles.panelTitle}><span className={styles.titleIcon}><UsersRound size={17} /></span><div><strong>协同任务组</strong><small>选择任务组配置方案</small></div></div><TaskGroupTree groups={mission.groups} selectedId={selectedGroupId} onSelect={selectGroup} /></section><section className={`${styles.panel} ${styles.modePanel}`}><div className={styles.panelTitle}><span className={styles.titleIcon}><GitBranch size={17} /></span><div><strong>协同模式配置</strong><small>{group?.name} · 选择一种简单协同模式</small></div></div><div className={styles.modeCards}>{(Object.keys(collaborationModeLabels) as CollaborationMode[]).map((mode) => { const Icon = modeIcons[mode]; const item = collaborationModeLabels[mode]; return <button className={`${styles.modeCard} ${group?.mode === mode ? styles.modeCardActive : ''}`} key={mode} onClick={() => setMode(mode)} type="button"><span className={styles.modeIcon}><Icon size={20} /></span><strong>{item.label}</strong><p>{item.description}</p><small>{item.suitable}</small></button>; })}</div><div className={styles.structureCard}><div className={styles.structureHeader}><span><UsersRound size={15} />当前任务组结构</span><b>{group?.drones.length ?? 0} 架无人机</b></div><div className={styles.structureNodes}>{group?.drones.map((droneId, index) => <div className={index === 0 && group.mode === 'LEADER' ? styles.leaderNode : styles.followerNode} key={droneId}><span>{index === 0 && group.mode === 'LEADER' ? 'L' : 'F'}</span><strong>{droneId}</strong><small>{index === 0 && group.mode === 'LEADER' ? 'Leader · 任务主机' : group.mode === 'RELAY' ? `接力节点 ${index + 1}` : 'Follower · 协同执行'}</small></div>)}</div></div></section></div></div>;
}
