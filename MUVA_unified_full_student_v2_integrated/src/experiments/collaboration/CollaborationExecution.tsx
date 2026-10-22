import { Check, Crosshair, MapPinned, Pause, Play, RadioTower, RotateCcw, Route, Settings2, Target, type LucideIcon } from 'lucide-react';
import { useState } from 'react';

import { useCollaborationStore } from '../../stores/collaborationStore';
import type { Point } from '../../types/swarm';
import { CollaborationMap } from './components/CollaborationMap';
import { DroneDetailPanel } from './components/DroneDetailPanel';
import { ProgressPanel } from './components/ProgressPanel';
import { TaskGroupTree } from './components/TaskGroupTree';
import styles from './Collaboration.module.css';

const taskActions: { label: string; icon: LucideIcon; map?: boolean; start?: boolean; pause?: boolean }[][] = [
  [{ label: '绘制航线', icon: Route, map: true }, { label: '修改航点', icon: Crosshair, map: true }, { label: '生成计划', icon: Check }, { label: '启动巡逻', icon: Play, start: true }, { label: '暂停', icon: Pause, pause: true }, { label: '返航', icon: RotateCcw }],
  [{ label: '绘制搜索范围', icon: MapPinned, map: true }, { label: '设置目标点', icon: Target, map: true }, { label: '生成航线', icon: Route }, { label: '启动搜索', icon: Play, start: true }, { label: '目标确认', icon: Check }],
  [{ label: '设置监测点', icon: Crosshair, map: true }, { label: '轮换配置', icon: Settings2 }, { label: '启动监测', icon: Play, start: true }, { label: '准备轮换', icon: RotateCcw }, { label: '结束监测', icon: Pause, pause: true }],
  [{ label: '设置运输点', icon: MapPinned, map: true }, { label: '配置物资', icon: Settings2 }, { label: '生成航线', icon: Route }, { label: '启动运输', icon: Play, start: true }, { label: '确认交付', icon: Check }],
  [{ label: '设置救援点', icon: Crosshair, map: true }, { label: '配置职责', icon: Settings2 }, { label: '生成航线', icon: Route }, { label: '启动救援', icon: Play, start: true }, { label: '请求支援', icon: RadioTower }],
];

export function CollaborationExecution() {
  const [taskPoints, setTaskPoints] = useState<Record<string, Point[]>>({});
  const [drawing, setDrawing] = useState(false);
  const [planReady, setPlanReady] = useState(false);
  const [notice, setNotice] = useState('选择任务后，可在共享地图上配置该任务');
  const mission = useCollaborationStore((state) => state.missionState);
  const selectedGroupId = useCollaborationStore((state) => state.selectedTaskGroup);
  const selectedDroneId = useCollaborationStore((state) => state.selectedDrone);
  const running = useCollaborationStore((state) => state.isRunning);
  const runningTaskGroups = useCollaborationStore((state) => state.runningTaskGroupIds);
  const elapsedSeconds = useCollaborationStore((state) => state.elapsedSeconds);
  const selectGroup = useCollaborationStore((state) => state.selectTaskGroup);
  const selectDrone = useCollaborationStore((state) => state.selectDrone);
  const start = useCollaborationStore((state) => state.startTaskExecution);
  const stop = useCollaborationStore((state) => state.stopTaskExecution);
  const group = mission.groups.find((item) => item.id === selectedGroupId);
  const task = mission.tasks.find((item) => item.id === group?.taskId);
  const selectedDrone = mission.drones.find((drone) => drone.id === selectedDroneId);
  const taskIndex = Math.max(0, mission.groups.findIndex((item) => item.id === selectedGroupId));
  const mapPoints = taskPoints[selectedGroupId] ?? [];
  const selectedTaskRunning = runningTaskGroups.includes(selectedGroupId);
  const actions = taskActions[taskIndex] ?? taskActions[0]!;

  function activateAction(action: (typeof actions)[number]) {
    if (action.map) {
      setDrawing((active) => !active);
      setNotice(drawing ? '地图标注已结束' : `地图标注中：${action.label}，点击地图添加点位`);
      return;
    }
    if (action.start) {
      setPlanReady(false);
      setNotice(`${task?.name ?? '任务'}已启动，正在共享空域执行`);
      start(selectedGroupId);
      return;
    }
    if (action.pause) {
      stop(selectedGroupId);
      setNotice(`${task?.name ?? '当前任务'}已暂停`);
      return;
    }
    if (action.label.includes('生成')) {
      setPlanReady(true);
      setNotice(`已生成${task?.name ?? '任务'}方案 · ${mapPoints.length} 个地图点位`);
      return;
    }
    setNotice(`${task?.name ?? '任务'}：${action.label}已确认`);
  }

  return <div className={`${styles.stepPage} ${styles.executionStep}`}><div className={styles.sharedExecution}>
    <aside className={styles.sharedTaskRail}><div className={styles.sharedRailTitle}><span className={styles.titleIcon}><MapPinned size={16} /></span><div><strong>任务列表</strong><small>选择独立任务，共享同一地图</small></div></div><TaskGroupTree groups={mission.groups} tasks={mission.tasks} selectedId={selectedGroupId} onSelect={(id) => { selectGroup(id); setDrawing(false); setPlanReady(false); setNotice('任务已切换，可在共享地图配置'); }} /></aside>
    <section className={`${styles.panel} ${styles.sharedMapPanel}`}><div className={styles.sharedMapHeading}><div><strong>{task?.name ?? '全局态势'}</strong><small>{task?.description ?? '查看所有无人机与协同任务的整体运行情况'}</small></div><span className={selectedTaskRunning ? styles.liveBadge : styles.pausedBadge}>{selectedTaskRunning ? '● LIVE' : '● READY'}</span><button type="button" title="重置当前任务进度" onClick={() => { stop(selectedGroupId); start(selectedGroupId); setNotice(`${task?.name ?? '任务'}重新启动`); }}><RotateCcw size={15} /></button></div><CollaborationMap mission={mission} selectedGroupId={selectedGroupId} selectedDrone={selectedDroneId} mapPoints={mapPoints} drawing={drawing} onMapClick={(point) => { setTaskPoints((current) => ({ ...current, [selectedGroupId]: [...(current[selectedGroupId] ?? []), point] })); setNotice(`当前任务已添加点位 ${mapPoints.length + 1}`); }} onDroneClick={selectDrone} />
      <div className={styles.taskActionBar}><div className={styles.taskActionContext}><span style={{ '--group-color': group?.color ?? '#34c9dc' } as React.CSSProperties} /><b>{task?.name ?? '任务操作'}</b><small>{notice}</small>{planReady && <em>计划已生成</em>}</div><div className={styles.taskActionButtons}>{actions.map((action) => { const Icon = action.icon; const active = action.map && drawing; return <button className={active || action.start && running ? styles.taskActionActive : ''} type="button" key={action.label} onClick={() => activateAction(action)}><Icon size={15} />{action.label}</button>; })}</div></div>
    </section>
    <aside className={styles.sharedInfoRail}><section className={styles.panel}><ProgressPanel groups={mission.groups} elapsedSeconds={elapsedSeconds} running={running} /></section><section className={styles.panel}><div className={styles.panelTitle}><strong>无人机状态</strong><small>点击地图标记查看详情</small></div><DroneDetailPanel drone={selectedDrone} /></section></aside>
  </div></div>;
}
