import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, Trophy } from 'lucide-react';

import { PanelShell } from '../../../components/common/PanelShell/PanelShell';
import { savedSwarmRecords } from '../../../stores/swarmStore';
import type { SwarmRun } from '../../../types/swarm';
import { SwarmMap } from './SwarmMap';
import styles from './Swarm.module.css';

export function SwarmRecordPage() {
  const [playback, setPlayback] = useState(100);
  const { id } = useParams();
  const result = savedSwarmRecords().find((record) => record.runId === id);
  if (!result) return <div className={styles.page}><div className={styles.content}><p>未找到这条实验二记录。</p><Link to="/records">返回实验记录</Link></div></div>;
  const run: SwarmRun | null = result.snapshot && result.config ? { id: result.runId, createdAt: result.completedAt, config: result.config, area: result.area, missions: result.missions, confirmed: true, checks: [], step: 6, result,
    snapshot: { ...result.snapshot, drones: result.snapshot.drones.map((drone) => { const trajectory = drone.trajectory.slice(0, Math.max(1, Math.ceil(drone.trajectory.length * playback / 100))); return { ...drone, trajectory, position: trajectory.at(-1) ?? drone.homePosition }; }) } } : null;
  return <div className={styles.page}><div className={styles.content}><PanelShell icon={Trophy} title={`实验二报告 · ${result.runId}`}><div className={styles.metrics}><div>成绩<strong>{result.score} 分</strong></div><div>覆盖率<strong>{result.coverage.toFixed(1)}%</strong></div><div>状态<strong>{result.status}</strong></div><div>运行时间<strong>{result.elapsed.toFixed(1)}s</strong></div><div>规划距离<strong>{result.plannedDistance.toFixed(1)}m</strong></div><div>轨迹距离<strong>{result.actualDistance.toFixed(1)}m</strong></div></div>{result.feedback.map((message) => <p key={message}>{message}</p>)}<p>完成时间：{new Date(result.completedAt).toLocaleString('zh-CN')} · {result.config?.count ?? '—'} 架无人机 · 区域 {result.area?.area.toFixed(1) ?? '—'}m²</p><div className={styles.actions}><Link to="/records">返回实验记录</Link><Link to="/experiments/swarm">再次实验</Link></div></PanelShell><PanelShell icon={Activity} title="事件与遥测轨迹">{run && <><SwarmMap run={run} /><label className={styles.field}>回放进度 {playback}% <input type="range" min="0" max="100" value={playback} onChange={(event) => setPlayback(Number(event.target.value))} /></label></>}<div className={styles.logs}>{result.events.map((event, index) => <span key={index}>{event}</span>)}</div>{result.trajectories.map((item) => <p key={item.droneId}>{item.droneId} · {item.points.length} 个轨迹采样点</p>)}</PanelShell></div></div>;
}
