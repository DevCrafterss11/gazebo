import { ArrowRight, Battery, Boxes, Check, ClipboardCheck, Drone, MapPinned, Play, RotateCcw, Route, Send, ShieldCheck, Signal } from 'lucide-react';
import { PanelShell } from '../../../components/common/PanelShell/PanelShell';
import { polygonCenter, swarmFrame } from '../../../domain/swarmGeometry';
import { minimumCoverageRectangle } from '../../../domain/swarmCoverage';
import { completeMissionPath, deliveryLabels, deliveryStatus, missionUploaded } from '../../../domain/swarmMissionWorkflow';
import { swarmColors } from '../../../domain/swarmPlanning';
import { useSwarmStore } from '../../../stores/swarmStore';
import type { SwarmDeliveryStatus, SwarmRun } from '../../../types/swarm';
import { SwarmMap } from './SwarmMap';
import styles from './Swarm.module.css';
import planningStyles from './MissionPlanningStep.module.css';

const milestones: SwarmDeliveryStatus[] = ['UNPLANNED', 'GENERATED', 'CHECKED', 'UPLOADED', 'WAITING_TAKEOFF'];
const duration = (seconds: number) => `${Math.floor(seconds / 60)}分${Math.ceil(seconds % 60)}秒`;

export function MissionPlanningStep({ run }: { run: SwarmRun }) {
  const { plan, checkPlan, uploadPlan, confirmPlan, navigate, busy, selectedDroneId, selectDrone, focusRevision } = useSwarmStore();
  const selected = selectedDroneId ?? run.missions[0]?.droneId ?? run.snapshot?.drones[0]?.droneId;
  const status = deliveryStatus(run);
  const uploaded = missionUploaded(run);
  const progress = milestones.indexOf(status === 'UPLOADING' ? 'CHECKED' : status);
  const { toLocal } = swarmFrame(run.config.sceneOrigin);
  const center = run.area ? run.area.center ?? polygonCenter(run.area.polygon.coordinates[0]!.slice(0, -1), run.config.sceneOrigin) : null;
  const rectangleArea = run.area ? minimumCoverageRectangle(run.area, run.config.sceneOrigin).area : 0;
  const total = run.missions.reduce((sum, mission) => sum + mission.plannedDistance, 0);
  const coveredArea = run.missions.reduce((sum, mission) => sum + mission.assignedArea, 0);
  return <div className={`${styles.workspace} ${planningStyles.workspace}`} data-delivery-status={status}>
    <aside className={styles.leftColumn} aria-label="航线任务参数">
      <PanelShell icon={Boxes} title="航线规划参数">
        <dl className={planningStyles.parameters}>
          <div><dt>分配策略</dt><dd>可飞面积均衡分区</dd></div>
          <div><dt>覆盖方式</dt><dd>蛇形 / 矩形往返</dd></div>
          <div><dt>无人机</dt><dd>{run.config.count} 架 Iris</dd></div>
          <div><dt>高度 / 速度</dt><dd>{run.config.altitude} m / {run.config.speed} m/s</dd></div>
          <div><dt>航线 / 安全间距</dt><dd>{run.config.spacing} m / {run.config.safety} m</dd></div>
          <div><dt>禁飞缓冲</dt><dd>{run.config.safety / 2} m</dd></div>
        </dl>
        <div className={styles.buttonStack}>
          <button className={styles.primaryButton} type="button" disabled={busy} onClick={plan}><Play size={16} />生成航线</button>
          <button type="button" disabled={busy || !run.missions.length} onClick={plan}><RotateCcw size={16} />重新分配</button>
          <button type="button" disabled={busy} onClick={() => navigate(2)}><MapPinned size={16} />返回编辑区域</button>
        </div>
      </PanelShell>
      <PanelShell icon={Route} title="任务区域与航程" className={`${styles.fillPanel} ${planningStyles.summary}`}>
        <dl className={planningStyles.parameters}>
          <div><dt>边界顶点</dt><dd>{Math.max(0, (run.area?.polygon.coordinates[0]?.length ?? 1) - 1)} 个</dd></div>
          <div><dt>绘制区域面积</dt><dd>{(run.area?.area ?? 0).toFixed(0)} m²</dd></div>
          <div><dt>外接矩形面积</dt><dd>{rectangleArea.toFixed(0)} m²</dd></div>
          <div><dt>可飞覆盖面积</dt><dd>{run.missions.length ? `${coveredArea.toFixed(0)} m²` : '待生成'}</dd></div>
          <div><dt>任务分区</dt><dd>{run.missions.length ? `${run.missions.length} 个独立区域` : '待分配'}</dd></div>
          <div><dt>禁飞区域</dt><dd>{run.planning?.noFlyZones.length ?? 0} 个</dd></div>
          <div><dt>完整总航程</dt><dd>{run.missions.length ? `${(total / 1000).toFixed(2)} km` : '—'}</dd></div>
        </dl>
        {center && <p className={planningStyles.caption}>区域中心 WGS84<br />{center.map((value) => value.toFixed(6)).join(', ')}<br />ENU ({toLocal(center).map((value) => value.toFixed(1)).join(', ')}) m</p>}
        <p className={planningStyles.caption}>根据绘制顶点计算最小面积外接矩形，沿矩形长边生成蛇形轨迹；覆盖范围会包含部分原多边形以外区域，白线为原边界，黄线为矩形边界。入场和返航畅通时走直线，仅绕开禁飞缓冲与其他无人机等待点。逐机入场 → 并行覆盖 → 逐机返航；航段完成率不等于真实相机覆盖率。</p>
      </PanelShell>
    </aside>
    <PanelShell icon={Route} title="完整任务航线预览" className={styles.mapPanel} action={<span>{deliveryLabels[status]}</span>}>
      <SwarmMap run={run} selected={selected} focusRevision={focusRevision} />
    </PanelShell>
    <aside className={styles.rightColumn} aria-label="航线接收与无人机状态">
      <PanelShell icon={Drone} title="无人机任务与接收状态" className={styles.fillPanel}>
        <div className={planningStyles.fleet}>{run.snapshot?.drones.map((drone, index) => {
          const mission = run.missions.find((item) => item.droneId === drone.droneId);
          const receipt = run.delivery?.receipts.find((item) => item.droneId === drone.droneId);
          const missionIndex = run.missions.findIndex((item) => item.droneId === drone.droneId);
          const color = mission?.assignedColor ?? swarmColors[index]!;
          const position = toLocal(drone.position);
          return <button type="button" key={drone.droneId} className={`${planningStyles.droneCard} ${selected === drone.droneId ? planningStyles.selected : ''}`}
            aria-label={`定位 ${drone.droneId} 航线任务`} aria-pressed={selected === drone.droneId} onClick={() => selectDrone(drone.droneId)}>
            <div className={planningStyles.droneTitle}><Drone size={18} style={{ color }} /><strong style={{ color }}>{drone.droneId}</strong><span>{status === 'WAITING_TAKEOFF' ? '等待起飞' : '地面待命'}</span></div>
            <small className={uploaded && receipt?.status === 'ACCEPTED' ? planningStyles.success : planningStyles.caption}>
              {busy ? '正在下发航线…' : uploaded && receipt?.status === 'ACCEPTED' ? '✓ 航线接收成功' : mission ? '航线待下发' : '任务待分配'}
            </small>
            {mission && <div className={planningStyles.droneMetrics}>
              <span>{String.fromCharCode(65 + missionIndex)}区 · {mission.assignedArea.toFixed(0)} m²</span><span>{completeMissionPath(mission, drone).length} 航点</span>
              <span>{mission.plannedDistance.toFixed(0)} m 完整航程</span><span>约 {duration(mission.estimatedDuration)}</span>
            </div>}
            <div className={planningStyles.telemetry}><span><Battery size={12} />{drone.battery.toFixed(0)}%</span><span><Signal size={12} />通信正常</span></div>
            <small>ENU ({position.map((value) => value.toFixed(0)).join(', ')}) m</small>
          </button>;
        })}</div>
        {!run.missions.length && <p className={planningStyles.caption}>生成后显示每架无人机的分区、航程、时间与航点；点击卡片定位真实服务位置。</p>}
      </PanelShell>
      <PanelShell icon={ShieldCheck} title="航线检查">
        {run.delivery?.checks.length ? <ul className={planningStyles.checks}>{run.delivery.checks.map((check) => <li key={check.name} className={check.status === 'PASSED' ? planningStyles.success : planningStyles.failure} title={check.reason ?? check.description}>
          <span>{check.status === 'PASSED' ? '✓' : '×'} {check.name}</span><small>{check.status === 'PASSED' ? '通过' : check.reason}</small>
        </li>)}</ul> : <p className={planningStyles.caption}>生成航线后点击「检查航线」。全部通过才能下发，全部回执成功才能进入预检查。</p>}
      </PanelShell>
    </aside>
    <footer className={planningStyles.operations}>
      <ol className={planningStyles.workflow} aria-label="航线下发流程">{milestones.map((milestone, index) => <li key={milestone} aria-current={index === progress ? 'step' : undefined}
        className={index <= progress ? planningStyles.completed : ''}><span>{index < progress ? <Check size={12} /> : index + 1}</span>{milestone === 'CHECKED' && busy ? '正在下发…' : deliveryLabels[milestone]}</li>)}</ol>
      <div className={planningStyles.actionRow}>
        <p>服务 Home → 入场 → 蛇形扫描 → 返回服务 Home<br /><small>检查与下发不启动飞行；预检查通过后才解锁集群起飞。</small></p>
        <div className={planningStyles.buttons}>
          <button type="button" disabled={busy || !run.missions.length} onClick={checkPlan}><ClipboardCheck size={15} />检查航线</button>
          <button className={`${styles.primaryButton} ${planningStyles.primary}`} type="button" disabled={busy || status !== 'CHECKED'} onClick={() => void uploadPlan()}><Send size={15} />{busy ? '正在下发…' : uploaded ? '航线已下发' : '下发航线'}</button>
          <button className={`${styles.primaryButton} ${planningStyles.primary}`} type="button" disabled={busy || !uploaded} onClick={confirmPlan}>确认航线并进入下一步<ArrowRight size={15} /></button>
        </div>
      </div>
    </footer>
  </div>;
}
