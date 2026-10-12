import { useMemo, type CSSProperties } from 'react';
import { ArrowRight, Battery, Boxes, Check, ClipboardList, Drone, Lightbulb, MapPinned, Play, RadioTower, Save, Settings2, Signal } from 'lucide-react';

import { PanelShell } from '../../../components/common/PanelShell/PanelShell';
import { swarmFrame } from '../../../domain/swarmGeometry';
import { areaOverlapsNoFly, missionRegions, routeIntersectsNoFly, swarmColors } from '../../../domain/swarmPlanning';
import { useSwarmStore } from '../../../stores/swarmStore';
import type { SwarmConfig, SwarmDrone, SwarmRun } from '../../../types/swarm';
import { SwarmMap } from './SwarmMap';
import styles from './AreaPlanningStep.module.css';

const phaseLabels: Record<SwarmDrone['state'], string> = { READY: '待命', TAKING_OFF: '起飞中', HOLDING: '悬停', RUNNING: '巡航中', PAUSED: '已暂停', RETURNING: '返航中', LANDED: '已降落' };
const fields: { key: 'count' | 'altitude' | 'speed' | 'spacing' | 'safety'; label: string; min: number; max: number; unit: string }[] = [
  { key: 'count', label: '无人机数量', min: 2, max: 6, unit: '架' },
  { key: 'altitude', label: '飞行高度', min: 10, max: 120, unit: 'm' },
  { key: 'speed', label: '巡航速度', min: 1, max: 20, unit: 'm/s' },
  { key: 'spacing', label: '航线间距', min: 3, max: 50, unit: 'm' },
  { key: 'safety', label: '安全间距', min: 3, max: 13, unit: 'm' },
];

function TaskConfiguration({ config }: { config: SwarmConfig }) {
  const updateConfig = useSwarmStore((state) => state.updateConfig);
  return <PanelShell icon={Settings2} title="任务配置" className={styles.card}>
    <div className={styles.fields}>
      <label><span>实验模式</span><select aria-label="实验模式" value="coverage" onChange={() => undefined}><option value="coverage">区域覆盖巡航</option></select></label>
      {fields.map((field) => <label key={field.key}><span>{field.label}</span><span className={styles.input}>
        <input type="number" aria-label={field.label} min={field.min} max={field.max} step={field.key === 'count' ? 1 : 0.5} value={config[field.key]} onChange={(event) => updateConfig({ [field.key]: Number(event.target.value) })} /><small>{field.unit}</small>
      </span></label>)}
      <label><span>无人机型号</span><span className={styles.readonly}>Iris 四旋翼</span></label>
      <label><span>分配策略</span><span className={styles.readonly}>均衡分区</span></label>
    </div>
    <p className={styles.caption}>修改参数会清除旧航线，需要重新初始化机群。</p>
  </PanelShell>;
}

function FleetStatus({ run }: { run: SwarmRun }) {
  const { toLocal } = swarmFrame(run.config.sceneOrigin);
  const selected = useSwarmStore((state) => state.selectedDroneId);
  const selectDrone = useSwarmStore((state) => state.selectDrone);
  const count = Number.isInteger(run.config.count) ? Math.min(6, Math.max(0, run.config.count)) : 0;
  return <PanelShell icon={RadioTower} title="无人机列表 / 编队状态" className={`${styles.card} ${styles.fleet}`} action={<span className={styles.counter}>{run.snapshot?.drones.length ?? 0} / {count}</span>}>
    <div className={styles.droneList}>{!run.snapshot && <p className={styles.caption}>等待初始化，位置由机群服务返回。</p>}{run.snapshot?.drones.map((drone, index) => {
      const droneId = drone.droneId;
      const color = swarmColors[index]!;
      const position = toLocal(drone.position).map((value) => value.toFixed(0));
      return <button key={droneId} type="button" disabled={!drone} aria-label={`定位 ${droneId}`} aria-pressed={selected === droneId} onClick={() => selectDrone(droneId)}
        className={`${styles.droneCard} ${selected === droneId ? styles.selectedDrone : ''}`} style={{ '--uav-color': color } as CSSProperties}>
        <Drone className={styles.droneIcon} size={28} />
        <div className={styles.droneDetails}>
          <div className={styles.droneTitle}><strong>{droneId}</strong><span className={styles.badge}>{run.snapshot?.interrupted ? '需初始化' : drone ? phaseLabels[drone.state] : '未初始化'}</span><span className={styles.battery}><Battery size={13} />{drone ? `${drone.battery.toFixed(0)}%` : '—'}</span></div>
          <small>位置 ({position.join(', ')}, {drone?.altitude.toFixed(0) ?? '0'}) m</small>
          <div className={styles.droneTelemetry}><small>任务：{run.missions.some((mission) => mission.droneId === droneId) ? `${String.fromCharCode(65 + index)}区域覆盖` : '待分配'}</small><span><Signal size={12} />{drone && !run.snapshot?.interrupted ? '通信正常' : '未连接'}</span></div>
        </div>
      </button>;
    })}</div>
    <p className={styles.caption}>点击无人机定位 · ENU 坐标（m）</p>
  </PanelShell>;
}

export function AreaPlanningStep({ run }: { run: SwarmRun }) {
  const runtimeLabel = useSwarmStore((state) => state.runtimeLabel);
  const { toGeo } = swarmFrame(run.config.sceneOrigin);
  const { setArea, clearArea, addNoFlyZone, removeNoFlyZone, setHome, clearPlanning, savePlanning, initialize, navigate, selectedDroneId, focusRevision } = useSwarmStore();
  const regions = useMemo(() => missionRegions(run), [run]);
  const lines = run.missions.reduce((sum, mission) => sum + mission.coverageSegments.length, 0);
  const distance = run.missions.reduce((sum, mission) => sum + mission.plannedDistance, 0);
  const hasHome = !!run.config.homePosition;
  const canPlan = !!run.area && hasHome && !!run.snapshot && !run.snapshot.interrupted;
  const noFlyZones = run.planning?.noFlyZones ?? [];
  const areaOverlap = !!run.area && areaOverlapsNoFly(run.area, noFlyZones, run.config.sceneOrigin);
  const homeOverlap = !!run.config.homePosition && routeIntersectsNoFly([run.config.homePosition], noFlyZones, run.config.sceneOrigin);
  const serviceHomeOverlap = !!run.snapshot?.drones.some((drone) => routeIntersectsNoFly([drone.homePosition, drone.position], noFlyZones, run.config.sceneOrigin));
  const next = () => {
    if (!canPlan) return;
    navigate(3);
  };
  const example = () => {
    if (run.area) return;
    setArea([toGeo([-140, -20]), toGeo([160, -20]), toGeo([160, 268]), toGeo([-140, 268])]);
    addNoFlyZone([toGeo([180, -120]), toGeo([270, -120]), toGeo([270, -30]), toGeo([180, -30])]);
    setHome(toGeo([-90, -70]));
  };
  return <div className={styles.console}>
    <aside className={styles.left} aria-label="任务配置与实验提示">
      <TaskConfiguration config={run.config} />
      <PanelShell icon={Lightbulb} title="实验提示" className={`${styles.card} ${styles.tips}`}>
        <ol><li><span>1</span><div>绘制任务区域<small>单击逐点设置边界，最后双击完成闭合。</small></div></li><li><span>2</span><div>设置禁飞区与规划 Home<small>Home 是规划参考；实际起飞与返航点以服务为准。</small></div></li><li><span>3</span><div>进入航线分配<small>本步骤只确认区域；步骤3再生成、检查并确认航线。</small></div></li></ol>
        <button type="button" className={styles.example} disabled={!!run.area} onClick={example}><MapPinned size={14} />载入教学示例</button>
        <p className={styles.caption}>真实卫星底图需联网；飞行流程以当前机群服务为准。</p>
      </PanelShell>
    </aside>
    <PanelShell icon={MapPinned} title="区域规划地图" className={styles.mapPanel} action={<span className={styles.mapHeading}>校园训练区 <i /> 2D 卫星</span>}>
      <SwarmMap run={run} editable onArea={(points) => points.length ? setArea(points) : clearArea()} onNoFly={addNoFlyZone} onHome={setHome} onClear={clearPlanning} selected={selectedDroneId} focusRevision={focusRevision} />
    </PanelShell>
    <aside className={styles.right} aria-label="无人机状态与任务概览">
      <FleetStatus run={run} />
      <PanelShell icon={Boxes} title="环境信息" className={styles.card}><dl className={styles.info}>
        <div><dt>仿真环境</dt><dd className={styles.green}>{runtimeLabel}</dd></div>
        <div><dt>场景</dt><dd>校园训练区</dd></div>
        <div><dt>坐标</dt><dd>WGS84 / ENU</dd></div>
        <div><dt>任务区域</dt><dd>{regions.map((region) => region.name).join(' / ') || (run.area ? '已绘制 · 待分区' : '待绘制')}</dd></div>
        <div><dt>Home</dt><dd>{hasHome ? '已设置' : '待设置'}</dd></div>
        <div><dt>禁飞区</dt><dd>{run.planning?.noFlyZones.length ? <span className={styles.zoneTags}>{run.planning.noFlyZones.map((_, index) => <button type="button" key={index} aria-label={`删除禁飞区 ${index + 1}`} onClick={() => removeNoFlyZone(index)}>禁飞区 {index + 1} ×</button>)}</span> : '未设置'}</dd></div>
      </dl></PanelShell>
      <PanelShell icon={ClipboardList} title="任务概览" className={`${styles.card} ${styles.overview}`}><dl className={styles.info}>
        <div><dt>已选区域</dt><dd>{run.area ? 1 : 0} 个{run.area ? ` · ${(run.area.area / 10000).toFixed(2)} ha` : ''}</dd></div>
        <div><dt>任务分区</dt><dd>{regions.length ? `${regions.length} 个` : '生成航线后显示'}</dd></div>
        <div><dt>预计航线</dt><dd>{lines ? `${lines} 条覆盖航段` : '待生成'}</dd></div>
        <div><dt>实际覆盖率</dt><dd>{(run.snapshot?.coverage ?? 0).toFixed(1)}%</dd></div>
      </dl>
        {run.missions.length > 0 && <div className={styles.routeCounts}>{run.missions.map((mission, index) => <span key={mission.droneId} style={{ color: mission.assignedColor }}>{String.fromCharCode(65 + index)}: {mission.coverageSegments.length} 条</span>)}</div>}
        <p className={styles.caption}>确认区域后，在步骤3「航线分配」生成航线。此处无需提前生成。</p>
        <p className={styles.caption}>{distance ? `规划航程 ${(distance / 1000).toFixed(2)} km · ` : ''}覆盖率随实际模拟飞行更新。</p>
      </PanelShell>
    </aside>
    <footer className={styles.operationBar}>
      <div className={styles.current}><ClipboardList size={26} /><div><strong>当前步骤：<b>区域规划</b></strong><p>请完成任务区域、禁飞区和起降点设置。</p>
        {!!noFlyZones.length && <p className={styles.noFlyNotice} role="status">禁飞提示：{homeOverlap || serviceHomeOverlap ? '起降点位于禁飞区或航线经过禁飞区，请调整起降点或禁飞区；' : ''}{areaOverlap ? '任务区域与禁飞区重叠，生成航线时将尝试避让；' : '已设置禁飞区，生成航线时会检查避让；'}本步可继续，危险航线仍无法下发。</p>}
        <small>{run.planning?.savedAt ? `规划已保存 ${new Date(run.planning.savedAt).toLocaleTimeString('zh-CN')}` : '规划更改自动暂存，可手动保存检查点'}</small></div></div>
      <div className={styles.operations}>
        <button type="button" onClick={savePlanning}>{run.planning?.savedAt ? <Check size={16} /> : <Save size={16} />}保存规划</button>
        <button type="button" onClick={initialize}><Play size={16} />初始化机群</button>
        <button type="button" className={styles.primary} disabled={!canPlan} onClick={next}>确认规划并进入下一步<ArrowRight size={17} /></button>
      </div>
    </footer>
  </div>;
}
