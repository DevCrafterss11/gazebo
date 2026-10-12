import { useEffect, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, BarChart3, Boxes, Check, CheckCircle2, ClipboardCheck, ClipboardList, Download, Gauge, Info, Lightbulb, MapPinned, Play, RadioTower, RotateCcw, Save, ShieldCheck, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';

import { ConfirmDialog } from '../../../components/common/ConfirmDialog/ConfirmDialog';
import { PanelShell } from '../../../components/common/PanelShell/PanelShell';
import { swarmFrame } from '../../../domain/swarmGeometry';
import { missionUploaded } from '../../../domain/swarmMissionWorkflow';
import { savedSwarmRecords, useSwarmStore } from '../../../stores/swarmStore';
import type { SwarmCheck, SwarmConfig, SwarmRun } from '../../../types/swarm';
import { SwarmMap } from './SwarmMap';
import { AreaPlanningStep } from './AreaPlanningStep';
import { MissionPlanningStep } from './MissionPlanningStep';
import styles from './Swarm.module.css';

const names = ['机群配置', '区域规划', '航线分配', '预检查', '协同飞行', '实验结果'];
const colors = ['#08a9ff', '#21e89c', '#ffaf29', '#ba6dff', '#ff6c92', '#f2d56b'];
const number = (value: number) => Number.isFinite(value) ? value.toFixed(1) : '—';
const duration = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const droneColor = (index: number) => colors[index % colors.length];

function TipBar({ children, action }: { children: string[]; action?: React.ReactNode }) {
  return <section className={styles.tipBar}><div className={styles.tipHeading}><Lightbulb size={27} /><strong>实验提示</strong></div><ol>{children.map((item) => <li key={item}>{item}</li>)}</ol>{action && <div className={styles.tipAction}>{action}</div>}</section>;
}

function ConfigStep({ run }: { run: SwarmRun }) {
  const { toLocal } = swarmFrame(run.config.sceneOrigin);
  const { updateConfig, initialize, navigate, busy, runtimeLabel } = useSwarmStore();
  const field = (key: 'count' | 'altitude' | 'speed' | 'spacing' | 'safety', label: string, min: number, max: number, unit: string) => <label className={styles.field}><span>{label}</span><span className={styles.inputBox}><input type="number" disabled={busy} min={min} max={max} value={run.config[key]} onChange={(event) => updateConfig({ [key]: Number(event.target.value) })} />{unit}</span></label>;
  return <div className={styles.workspace}>
    <div className={styles.leftColumn}><PanelShell icon={Boxes} title="机群配置" className={styles.fillPanel}><div className={styles.fields}>
      <div className={styles.field}><span>实验模式</span><span className={styles.readonly}>区域覆盖巡航</span></div>
      {field('count', '无人机数量', 2, 6, '架')}{field('altitude', '飞行高度', 10, 120, 'm')}{field('speed', '巡航速度', 1, 20, 'm/s')}{field('spacing', '航线间距', 3, 50, 'm')}{field('safety', '安全间距', 3, 13, 'm')}
      <div className={styles.field}><span>无人机型号</span><span className={styles.readonly}>Iris 四旋翼</span></div><div className={styles.field}><span>分配策略</span><span className={styles.readonly}>均衡分区 · 分时起飞</span></div>
    </div><button className={styles.primaryButton} type="button" disabled={busy} onClick={initialize}><Play size={17} />{busy ? '连接飞控并验证参数…' : run.snapshot && !run.snapshot.interrupted ? '重新初始化机群' : '初始化机群'}</button><p className={styles.helper}>数量决定实际机群实例；高度与速度交给服务配置，等待心跳、GPS和参数确认后进入规划。</p></PanelShell></div>
    <PanelShell icon={MapPinned} title="起飞点预览" className={styles.mapPanel} action={<span>场景：校园训练区 · ENU</span>}><SwarmMap run={run} /></PanelShell>
    <div className={styles.rightColumn}><PanelShell icon={RadioTower} title="无人机列表" className={styles.fillPanel}><div className={styles.uavCards}>{!run.snapshot && <p className={styles.helper}>等待服务初始化机群。初始位置由服务返回，地图不预设无人机。</p>}{run.snapshot?.drones.map((drone, index) => {
      return <div className={styles.uavCard} style={{ borderLeftColor: droneColor(index) }} key={drone.droneId}><span className={styles.droneGlyph} style={{ color: droneColor(index) }}>✣</span><div><strong style={{ color: droneColor(index) }}>{drone.displayName} · SysID {drone.sysId}</strong><small>Iris 四旋翼 · 服务位置: ({toLocal(drone.position).map(Math.round).join(', ')}, {drone.altitude.toFixed(0)})</small>{drone.flightMode && <small>{drone.connected ? '飞控在线' : '飞控离线'} · {drone.flightMode} · GPS {drone.gpsFixType} · {drone.armed ? '已解锁' : '已上锁'}</small>}</div><span className={styles.uavBadge}>{drone.state}</span></div>;
    })}</div></PanelShell><PanelShell icon={Boxes} title="环境信息"><div className={styles.infoRows}><div>仿真环境 <b className={styles.success}>{runtimeLabel}</b></div><div>场景名称 <b>校园训练区</b></div><div>坐标基准 <b>WGS84 / ENU</b></div><div>场景范围 <b>中心 500 m</b></div><div>环境状态 <b className={styles.success}>{busy ? '配置中' : run.snapshot?.runtime?.connected === false ? '连接中断' : run.snapshot?.interrupted ? '已中断' : run.snapshot ? '● 已就绪' : '等待初始化'}</b></div></div></PanelShell></div>
    <TipBar action={<button className={styles.primaryButton} type="button" disabled={busy} onClick={() => navigate(2)}>确认配置并进入下一步 <ArrowRight size={18} /></button>}>{['在本步骤配置机群数量与飞行参数，机群数量支持 2–6 架。','UAV 编号、初始位置和返航点由机群服务返回，不在页面预设。','下一步逐点绘制区域；规划 Home 不会移动已经初始化的无人机。']}</TipBar>
  </div>;
}



function CheckStep({ run }: { run: SwarmRun }) {
  const { check, navigate } = useSwarmStore.getState();
  const checks: SwarmCheck[] = run.checks.length ? run.checks : ['机群配置','唯一编号','初始位置','区域规划','航线完整性','航线几何安全','航线下发','任务分配','安全间距','运行时','任务状态','任务参数'].map((name) => ({ name, description: '等待自动检查', status: 'PENDING' }));
  const passed = checks.filter((item) => item.status === 'PASSED').length;
  const ready = passed === checks.length && missionUploaded(run) && run.delivery?.status === 'WAITING_TAKEOFF';
  return <div className={styles.workspace}>
    <div className={styles.leftColumn}><PanelShell icon={ClipboardCheck} title="预飞检查清单" className={styles.fillPanel}><div className={styles.checkList}>{checks.map((item) => <div key={item.name} className={styles.checkItem}><span className={item.status === 'PASSED' ? styles.passedIcon : styles.pendingIcon}>{item.status === 'PASSED' ? <Check size={16} /> : '?'}</span><div><strong>{item.name}</strong><small>{item.reason ? `${item.reason}；${item.suggestion}` : item.description}</small></div><span className={item.status === 'PASSED' ? styles.passBadge : styles.waitBadge}>{item.status === 'PASSED' ? '通过' : item.status === 'FAILED' ? '失败' : '待检查'}</span></div>)}</div><button className={styles.primaryButton} type="button" onClick={check}><ShieldCheck size={16} />执行自动检查</button></PanelShell></div>
    <div className={styles.centerColumn}><PanelShell icon={MapPinned} title="检查态势预览" className={styles.mapPanel}><SwarmMap run={run} /></PanelShell></div>
    <div className={styles.rightColumn}><PanelShell icon={RadioTower} title="机群实时状态" className={styles.fillPanel}><div className={styles.uavCards}>{run.snapshot?.drones.map((drone, index) => <div className={styles.uavCard} key={drone.droneId} style={{ borderLeftColor: droneColor(index) }}><span className={styles.droneGlyph} style={{ color: droneColor(index) }}>✣</span><div><strong style={{ color: droneColor(index) }}>{drone.droneId}</strong><small>高度 {number(drone.altitude)}m · 速度 {number(drone.speed)}m/s</small></div><span className={styles.uavBadge}>{number(drone.battery)}%</span></div>)}</div></PanelShell><PanelShell icon={ShieldCheck} title="启动条件"><div className={styles.readyBox}><CheckCircle2 size={43} /><div><span>检查通过率</span><strong>{Math.round(passed / checks.length * 100)}%</strong><small>{ready ? '等待起飞 · 航线已接收' : '请先完成全部预飞检查'}</small></div></div></PanelShell></div>
    <TipBar action={<button className={styles.primaryButton} disabled={!ready} onClick={() => navigate(5)} type="button">进入飞行控制 <ArrowRight size={17} /></button>}>{['确保所有预飞检查均通过，方可执行集群起飞。','自动检查会校验起飞间距、航线完整性和当前服务连接状态。','进入协同飞行后，可按顺序起飞、巡航、暂停和返航。']}</TipBar>
  </div>;
}

function FlightControls({ run }: { run: SwarmRun }) {
  const { command, finish } = useSwarmStore.getState();
  const [confirm, setConfirm] = useState<'return' | 'finish' | null>(null);
  const state = run.snapshot?.status;
  return <><div className={styles.flightControls}><button type="button" disabled={state !== 'READY' || !missionUploaded(run) || run.delivery?.status !== 'WAITING_TAKEOFF'} onClick={() => command('takeoff')}>↑<span>集群起飞</span></button><button type="button" disabled={state !== 'HOLDING'} onClick={() => command('startMission')}>▶<span>开始任务</span></button><button className={styles.primaryButton} type="button" disabled={state !== 'RUNNING'} onClick={() => command('pauseMission')}>Ⅱ<span>暂停任务</span></button><button type="button" disabled={state !== 'PAUSED'} onClick={() => command('resumeMission')}>▶<span>继续任务</span></button><button className={styles.returnButton} type="button" disabled={!['RUNNING','PAUSED','HOLDING','TAKING_OFF'].includes(state ?? '')} onClick={() => setConfirm('return')}>⌂<span>集群返航</span></button><button className={styles.dangerButton} type="button" onClick={() => setConfirm('finish')}>■<span>结束实验</span></button></div>
  {confirm && <ConfirmDialog title={confirm === 'return' ? '确认集群返航' : '确认结束实验'} description={confirm === 'return' ? '未完成的区域将计为覆盖缺口，所有无人机安全返航。' : '运行中的无人机会先安全返航并降落，再生成实验结果。'} onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm === 'return') command('returnToHome'); else finish(); setConfirm(null); }} />}</>;
}

function FlightStep({ run }: { run: SwarmRun }) {
  const { command } = useSwarmStore.getState();
  const [selected, setSelected] = useState('UAV-01');
  const snapshot = run.snapshot;
  const coverageArea = run.missions.reduce((sum, mission) => sum + mission.assignedArea, 0);
  if (!snapshot) return null;
  return <div className={styles.workspace}>
    <div className={styles.leftColumn}><PanelShell icon={ClipboardList} title="任务概览"><div className={styles.infoRows}><div>任务模式 <b>区域覆盖巡航</b></div><div>无人机数量 <b>{run.config.count} 架</b></div><div>当前状态 <b className={styles.success}>{snapshot.status}</b></div><div>覆盖率 <b className={styles.accent}>{number(snapshot.coverage)}%</b></div><div className={styles.progressTrack}><i style={{ width: `${snapshot.coverage}%` }} /></div><div>总航程 <b>{number(run.missions.reduce((sum, item) => sum + item.plannedDistance, 0) / 1000)} km</b></div><div>已用时 <b>{duration(snapshot.elapsed)}</b></div></div></PanelShell>
    <PanelShell icon={Activity} title="飞行参数曲线" className={styles.fillPanel}><div className={styles.chartLegend}>{snapshot.drones.map((drone, index) => <span key={drone.droneId} style={{ color: droneColor(index) }}>━ {drone.droneId}</span>)}</div><div className={styles.chart}><div className={styles.chartGrid}>{[40,30,20,10,0].map((height) => <span key={height}>{height}</span>)}</div><div className={styles.chartLines}>{snapshot.drones.map((drone, index) => <div key={drone.droneId} style={{ background: droneColor(index), bottom: `${Math.min(drone.altitude, 40) / 40 * 85 + 7}%` }} />)}</div></div><small>实时高度（m）· 地图轨迹和单机遥测以运行时数据为准</small></PanelShell></div>
    <div className={styles.centerColumn}><PanelShell icon={MapPinned} title="协同飞行态势" className={styles.mapPanel}><SwarmMap run={run} selected={selected} /></PanelShell><PanelShell icon={Gauge} title="集群飞行控制"><FlightControls run={run} /></PanelShell></div>
    <div className={styles.rightColumn}><PanelShell icon={RadioTower} title="机群实时状态" className={styles.fillPanel}><div className={styles.uavCards}>{snapshot.drones.map((drone, index) => <button className={`${styles.uavCard} ${selected === drone.droneId ? styles.selectedUav : ''}`} type="button" onClick={() => setSelected(drone.droneId)} key={drone.droneId} style={{ borderLeftColor: droneColor(index) }}><span className={styles.droneGlyph} style={{ color: droneColor(index) }}>✣</span><div><strong style={{ color: droneColor(index) }}>{drone.droneId} <small>SYSID: {drone.sysId}</small></strong><small>进度 {number(drone.progress)}% · 高度 {number(drone.altitude)}m · 电量 {number(drone.battery)}%</small></div><span className={styles.uavBadge}>{drone.state}</span></button>)}</div>{snapshot.drones.filter((drone) => drone.droneId === selected).map((drone) => <div className={styles.selectedDetails} key={drone.droneId}>已完成 {drone.completedSegments} 条扫描航段 · 速度 {number(drone.speed)}m/s · 航点 {drone.waypointIndex}<button type="button" disabled={!['RUNNING','PAUSED','HOLDING'].includes(drone.state)} onClick={() => command('returnToHome', drone.droneId)}>单机返航</button></div>)}</PanelShell><PanelShell icon={BarChart3} title="任务执行统计"><div className={styles.metrics}><div>任务覆盖率<strong>{number(snapshot.coverage)}%</strong></div><div>可飞覆盖面积<strong>{number(coverageArea / 10000)} ha</strong></div><div>安全间距<strong>{run.config.safety} m</strong></div><div>估算已完成面积<strong>{number(coverageArea * snapshot.coverage / 10000 / 100)} ha</strong></div></div></PanelShell><PanelShell icon={ClipboardList} title="系统事件日志"><div className={styles.logs}>{snapshot.events.slice(-7).map((event, index) => <span key={index}><i />{event}</span>)}</div></PanelShell></div>
    {snapshot.interrupted && <div className={styles.interrupted}>模拟运行已中断，不能继续飞行。请结束本次实验或返回配置重新初始化。</div>}
  </div>;
}

function ResultStep({ run }: { run: SwarmRun }) {
  const { save, newRun } = useSwarmStore.getState();
  const busy = useSwarmStore((state) => state.busy);
  const runtimeLabel = useSwarmStore((state) => state.runtimeLabel);
  const [playback, setPlayback] = useState(100);
  const [saved, setSaved] = useState(false);
  const result = run.result;
  const coverageArea = run.missions.reduce((sum, mission) => sum + mission.assignedArea, 0);
  if (!result) return null;
  const replay: SwarmRun = run.snapshot ? { ...run, snapshot: { ...run.snapshot, drones: run.snapshot.drones.map((drone) => { const trajectory = drone.trajectory.slice(0, Math.max(1, Math.ceil(drone.trajectory.length * playback / 100))); return { ...drone, trajectory, position: trajectory.at(-1) ?? drone.homePosition }; }) } } : run;
  const exportReport = () => { const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${run.id}-report.json`; anchor.click(); URL.revokeObjectURL(url); };
  return <div className={styles.workspaceResult}>
    <PanelShell icon={Trophy} title="实验任务完成情况"><div className={styles.resultSummary}><div className={styles.coverageRing} style={{ '--coverage': `${result.coverage}%` } as React.CSSProperties}><div><strong>{number(result.coverage)}%</strong><span>区域覆盖率</span></div></div><div className={styles.metrics}><div>可飞覆盖面积<strong>{number(coverageArea / 10000)} ha</strong></div><div>估算已覆盖面积<strong>{number(coverageArea * result.coverage / 10000 / 100)} ha</strong></div><div>总航程<strong>{number(result.actualDistance / 1000)} km</strong></div><div>总耗时<strong>{duration(result.elapsed)}</strong></div><div>完成无人机<strong>{run.snapshot?.drones.filter((drone) => drone.state === 'LANDED').length ?? 0} / {run.config.count}</strong></div><div>任务状态<strong className={result.status === 'COMPLETED' ? styles.success : styles.warning}>{result.status}</strong></div></div></div></PanelShell>
    <PanelShell icon={Trophy} title="评分结果"><div className={styles.scoreLayout}><div className={styles.scoreShield}><strong>{result.score}</strong><small>分</small><b>{result.score >= 85 ? '优秀' : result.score >= 60 ? '合格' : '待改进'}</b></div><div className={styles.scoreItems}>{[['机群配置与安全着陆', run.snapshot?.drones.every((drone) => drone.state === 'LANDED') ? 10 : 0, 10], ['规划与航线执行', result.status === 'COMPLETED' ? 20 : 0, 20], ['区域覆盖率', Math.round(result.coverage * 0.7), 70]].map(([title, points, maximum]) => <div key={String(title)}><span>{title}</span><b>{points} / {maximum}</b><i><em style={{ width: `${Number(points) / Number(maximum) * 100}%` }} /></i></div>)}</div></div></PanelShell>
    <PanelShell icon={Play} title="飞行轨迹回放" className={`${styles.mapPanel} ${styles.resultMap}`}><SwarmMap run={replay} /><div className={styles.playback}><span>{duration(result.elapsed * playback / 100)} / {duration(result.elapsed)}</span><input aria-label="轨迹回放进度" type="range" min="0" max="100" value={playback} onChange={(event) => setPlayback(Number(event.target.value))} /><span>{playback}%</span></div></PanelShell>
    <PanelShell icon={ClipboardList} title="实验记录与报告"><div className={styles.infoRows}><div>实验编号 <b>{run.id.slice(0, 24)}</b></div><div>开始时间 <b>{new Date(run.createdAt).toLocaleString('zh-CN')}</b></div><div>结束时间 <b>{new Date(result.completedAt).toLocaleString('zh-CN')}</b></div><div>实验模式 <b>{runtimeLabel}</b></div><div>无人机数量 <b>{run.config.count} 架</b></div><div>实验状态 <b className={result.status === 'COMPLETED' ? styles.success : styles.warning}>{result.status}</b></div></div><h3>关键事件记录</h3><div className={styles.logs}>{result.events.slice(-5).map((event, index) => <span key={index}><i />{event}</span>)}</div>{result.feedback.map((message) => <p className={styles.helper} key={message}>{message}</p>)}</PanelShell>
    <div className={styles.resultActions}><button className={styles.primaryButton} type="button" onClick={() => { save(); setSaved(true); }}><ClipboardCheck size={17} />{saved ? '记录已保存' : '保存实验记录'}</button><button className={styles.primaryButton} type="button" onClick={exportReport}><Download size={17} />导出报告</button><button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void newRun()}><RotateCcw size={17} />{busy ? '确认落地并关闭旧飞控…' : '重新实验'}</button><Link to="/experiments"><ArrowLeft size={17} />返回实验中心</Link></div>
  </div>;
}

export function SwarmExperimentPage() {
  const { run, savedDrafts, error, busy, newRun, restoreDraft, resume, navigate, leave } = useSwarmStore();
  const [active, setActive] = useState(false);
  const startNew = async () => {
    if (busy) return;
    if (run && !run.result && !window.confirm('当前实验进度将保留，可在入口重新恢复。新实验从空白区域开始，是否继续？')) return;
    const previousId = run?.id;
    await newRun();
    if (useSwarmStore.getState().run?.id !== previousId) setActive(true);
  };
  useEffect(() => {
    if (!active) return;
    resume();
    window.addEventListener('pagehide', leave);
    const restore = () => resume();
    window.addEventListener('pageshow', restore);
    return () => { window.removeEventListener('pagehide', leave); window.removeEventListener('pageshow', restore); leave(); };
  }, [active, leave, resume]);
  if (!run || !active) return <div className={styles.page}>
    <div className={styles.experimentHeading}><div className={styles.headingIcon}><ClipboardList size={28} /></div><div><h1>实验二：多无人机集群区域规划与协同飞行</h1><p>通过多无人机的区域覆盖任务，学习机群任务分配、航线规划与协同起降，掌握集群作业的基本方法。</p></div></div>
    <div className={styles.entry}><PanelShell icon={Boxes} title="实验介绍">
      <h2>从区域规划到协同巡航</h2><p>先自主绘制任务边界，再生成智能覆盖航线。新实验不会自动载入区域、分区或航线；教学示例需手动载入。</p>
      <div className={styles.entryStages}>{names.map((name, index) => <div key={name}><span>{index + 1}</span>{name}</div>)}</div>
      {error && <div role="alert" className={styles.error}>{error}</div>}
      {run && !run.result && <div className={styles.progressSummary}><strong>上次进度已保留</strong><span>{new Date(run.createdAt).toLocaleString('zh-CN')} · 当前阶段：{names[run.step - 1]} · 飞行进度 {(run.snapshot?.coverage ?? 0).toFixed(1)}%</span><small>点击继续才恢复运行；等待选择期间不推进飞行。</small></div>}
      <div className={styles.actions}>
        <button className={styles.primaryButton} type="button" onClick={startNew}>{run && !run.result ? '重新开始实验' : '开始新实验'} <ArrowRight size={17} /></button>
        {run && !run.result && <button type="button" onClick={() => setActive(true)}>继续上次进度</button>}
        {run?.result && <button type="button" onClick={() => setActive(true)}>查看上次结果</button>}
      </div>
      {savedDrafts.some((draft) => draft.id !== run?.id) && <section className={styles.savedProgress} aria-label="已保留的实验进度"><h3>已保留的实验进度</h3><ul>{savedDrafts.filter((draft) => draft.id !== run?.id).map((draft) => <li key={draft.id}><div><strong>{new Date(draft.createdAt).toLocaleString('zh-CN')}</strong><small>{names[draft.step - 1]} · {(draft.snapshot?.coverage ?? 0).toFixed(1)}% · {duration(draft.snapshot?.elapsed ?? 0)}</small></div><button type="button" aria-label={`恢复保留进度 ${draft.id}`} onClick={() => { restoreDraft(draft.id); if (useSwarmStore.getState().run?.id === draft.id && !useSwarmStore.getState().error) setActive(true); }}>恢复这份进度</button></li>)}</ul></section>}
      <p>本地已保存 {savedSwarmRecords().length} 条实验二结果记录。重新开始会保留未完成进度，不删除已有实验记录。</p>
    </PanelShell></div>
  </div>;
  const allowed = (step: number) => step <= 2 || step === 3 && !!run.area && !!run.snapshot || step === 4 && run.confirmed && missionUploaded(run) || step === 5 && missionUploaded(run) && run.checks.length > 0 && run.checks.every((item) => item.status === 'PASSED') || step === 6 && !!run.result;
  const completed = (step: number) => step < run.step && (step !== 2 || !!run.area) && (step !== 3 || run.confirmed) && (step !== 4 || run.checks.length > 0 && run.checks.every((item) => item.status === 'PASSED'));
  return <div className={styles.page}><div className={styles.experimentHeading}><div className={styles.headingIcon}><ClipboardList size={28} /></div><div><h1>实验二：多无人机集群区域规划与协同飞行</h1><p>通过多无人机的区域覆盖任务，学习机群任务分配、航线规划与协同起降，掌握集群作业的基本方法。</p></div><div className={styles.sessionActions}><button type="button" onClick={() => { leave(); setActive(false); }}><Save size={13} />保留进度并返回</button><button type="button" onClick={startNew}><RotateCcw size={13} />重新开始实验</button></div></div>
    <nav className={styles.stepper} aria-label="实验步骤">{names.map((title, index) => <button key={title} type="button" disabled={!allowed(index + 1) || index + 1 === run.step} className={index + 1 === run.step ? styles.currentStep : completed(index + 1) ? styles.completedStep : ''} onClick={() => navigate(index + 1)}><span>{completed(index + 1) ? <Check size={18} /> : index + 1}</span>{title}</button>)}</nav>
    <div className={styles.content}>{error && <div role="alert" className={styles.error}>{error}<button type="button" onClick={() => useSwarmStore.getState().clearError()}>关闭</button></div>}{run.snapshot?.interrupted && run.step !== 5 && run.step !== 6 && <div className={styles.error}>上次模拟运行已中断，请重新初始化机群。<button type="button" onClick={() => useSwarmStore.getState().finish()}>中断结束并查看结果</button></div>}
      {run.step === 1 && <ConfigStep run={run} />}{run.step === 2 && <AreaPlanningStep run={run} />}{run.step === 3 && <MissionPlanningStep run={run} />}{run.step === 4 && <CheckStep run={run} />}{run.step === 5 && <FlightStep run={run} />}{run.step === 6 && <ResultStep run={run} />}
    </div></div>;
}
