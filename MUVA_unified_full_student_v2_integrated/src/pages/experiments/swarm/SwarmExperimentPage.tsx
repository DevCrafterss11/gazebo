import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowLeft, ArrowRight, BarChart3, Boxes, Check, CheckCircle2, ClipboardCheck, ClipboardList, Download, Gauge, Info, Lightbulb, MapPinned, Play, RadioTower, RotateCcw, Route, ShieldCheck, Trophy } from 'lucide-react';
import { Link } from 'react-router-dom';

import { ConfirmDialog } from '../../../components/common/ConfirmDialog/ConfirmDialog';
import { PanelShell } from '../../../components/common/PanelShell/PanelShell';
import { homes, toLocal } from '../../../domain/swarmGeometry';
import { savedSwarmRecords, useSwarmStore } from '../../../stores/swarmStore';
import type { SwarmCheck, SwarmConfig, SwarmRun } from '../../../types/swarm';
import { SwarmMap } from './SwarmMap';
import styles from './Swarm.module.css';

const names = ['机群配置', '区域规划', '航线分配', '预飞检查', '协同飞行', '实验结果'];
const colors = ['#08a9ff', '#21e89c', '#ffaf29', '#ba6dff', '#ff6c92'];
const number = (value: number) => Number.isFinite(value) ? value.toFixed(1) : '—';
const duration = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
const droneColor = (index: number) => colors[index % colors.length];

function TipBar({ children, action }: { children: string[]; action?: React.ReactNode }) {
  return <section className={styles.tipBar}><div className={styles.tipHeading}><Lightbulb size={27} /><strong>实验提示</strong></div><ol>{children.map((item) => <li key={item}>{item}</li>)}</ol>{action && <div className={styles.tipAction}>{action}</div>}</section>;
}

function ConfigStep({ run }: { run: SwarmRun }) {
  const { updateConfig, initialize, navigate } = useSwarmStore.getState();
  const field = (key: 'count' | 'altitude' | 'speed' | 'spacing' | 'safety', label: string, min: number, max: number, unit: string) => <label className={styles.field}><span>{label}</span><span className={styles.inputBox}><input type="number" min={min} max={max} value={run.config[key]} onChange={(event) => updateConfig({ [key]: Number(event.target.value) })} />{unit}</span></label>;
  return <div className={styles.workspace}>
    <div className={styles.leftColumn}><PanelShell icon={Boxes} title="机群配置" className={styles.fillPanel}><div className={styles.fields}>
      <div className={styles.field}><span>实验模式</span><span className={styles.readonly}>区域覆盖巡航</span></div>
      {field('count', '无人机数量', 2, 5, '架')}{field('altitude', '飞行高度', 10, 120, 'm')}{field('speed', '巡航速度', 1, 20, 'm/s')}{field('spacing', '航线间距', 3, 50, 'm')}{field('safety', '安全间距', 3, 13, 'm')}
      <div className={styles.field}><span>无人机型号</span><span className={styles.readonly}>Iris 四旋翼</span></div><div className={styles.field}><span>分配策略</span><span className={styles.readonly}>均衡分区 · 分时起飞</span></div>
    </div><button className={styles.primaryButton} type="button" onClick={initialize}><Play size={17} />{run.snapshot && !run.snapshot.interrupted ? '重新初始化机群' : '初始化机群'}</button></PanelShell></div>
    <PanelShell icon={MapPinned} title="起飞点预览" className={styles.mapPanel} action={<span>场景：校园训练区 · ENU</span>}><SwarmMap run={run} /></PanelShell>
    <div className={styles.rightColumn}><PanelShell icon={RadioTower} title="无人机列表" className={styles.fillPanel}><div className={styles.uavCards}>{homes(run.config.count).map((home, index) => {
      const drone = run.snapshot?.drones[index];
      return <div className={styles.uavCard} style={{ borderLeftColor: droneColor(index) }} key={index}><span className={styles.droneGlyph} style={{ color: droneColor(index) }}>✣</span><div><strong style={{ color: droneColor(index) }}>UAV-{String(index + 1).padStart(2, '0')}</strong><small>Iris 四旋翼 · 起飞点: ({toLocal(home).map(Math.round).join(', ')}, 0)</small></div><span className={styles.uavBadge}>{drone?.state ?? '待命'}</span></div>;
    })}</div></PanelShell><PanelShell icon={Boxes} title="环境信息"><div className={styles.infoRows}><div>仿真环境 <b className={styles.success}>Mock 模式</b></div><div>场景名称 <b>校园训练区</b></div><div>坐标基准 <b>WGS84 / ENU</b></div><div>场景范围 <b>中心 500 m</b></div><div>环境状态 <b className={styles.success}>{run.snapshot?.interrupted ? '已中断' : run.snapshot ? '● 已就绪' : '等待初始化'}</b></div></div></PanelShell></div>
    <TipBar action={<button className={styles.primaryButton} type="button" disabled={!run.snapshot || !!run.snapshot.interrupted} onClick={() => navigate(2)}>确认配置并进入下一步 <ArrowRight size={18} /></button>}>{['在本步骤配置机群数量与飞行参数，机群数量支持 2–5 架。','系统会按当前数量生成独立的 UAV 编号与起飞点。','请先点击「初始化机群」，再进入区域规划。']}</TipBar>
  </div>;
}

function AreaStep({ run }: { run: SwarmRun }) {
  const { setArea, clearArea, navigate } = useSwarmStore.getState();
  const [tool, setTool] = useState<'polygon' | 'rectangle' | 'edit' | 'delete' | 'reset' | null>(null);
  const choose = (value: typeof tool) => { setTool(value); window.dispatchEvent(new CustomEvent('swarm-map-tool', { detail: value })); if (value === 'reset') clearArea(); };
  return <div className={styles.workspace}>
    <div className={styles.leftColumn}><PanelShell icon={Boxes} title="区域绘制工具"><div className={styles.toolGrid}>
      <button className={tool === 'polygon' ? styles.toolActive : ''} type="button" onClick={() => choose('polygon')}>▱ 绘制多边形</button><button className={tool === 'rectangle' ? styles.toolActive : ''} type="button" onClick={() => choose('rectangle')}>□ 绘制矩形</button>
      <button className={tool === 'edit' ? styles.toolActive : ''} type="button" onClick={() => choose('edit')} disabled={!run.area}>✎ 编辑顶点</button><button className={tool === 'delete' ? styles.toolActive : ''} type="button" onClick={() => choose('delete')} disabled={!run.area}>⌫ 删除顶点</button><button className={styles.fullWidth} type="button" onClick={() => choose('reset')}>⟲ 重置区域</button>
    </div><p className={styles.helper}>在地图上绘制区域；多边形完成后点击地图顶部的「完成绘制」。</p></PanelShell>
    <PanelShell icon={MapPinned} title="区域参数" className={styles.fillPanel}><div className={styles.infoRows}><div>区域面积 <b className={styles.accent}>{run.area ? `${number(run.area.area / 10000)} ha` : '—'}</b></div><div>区域周长 <b className={styles.accent}>{run.area ? `${number(run.area.perimeter)} m` : '—'}</b></div><div>飞行高度 <b>{run.config.altitude} m</b></div><div>航线间距 <b>{run.config.spacing} m</b></div><div>无人机数量 <b>{run.config.count} 架</b></div><div>区域校验 <b className={run.area ? styles.success : styles.warning}>{run.area ? '✓ 已通过' : '等待绘制'}</b></div></div></PanelShell></div>
    <PanelShell icon={MapPinned} title="区域规划" className={styles.mapPanel}><SwarmMap run={run} editable onArea={(points) => points.length ? setArea(points) : clearArea()} /></PanelShell>
    <div className={styles.rightColumn}><PanelShell icon={ClipboardList} title="区域概览与说明" className={styles.fillPanel}><div className={styles.overview}><div className={styles.miniMap}><SwarmMap run={run} /></div><p>任务区域覆盖 <strong>{run.config.count} 架无人机</strong>的协同巡检区域</p><div className={styles.infoRows}><div>建议高度 <b className={styles.accent}>{run.config.altitude} m</b></div><div>建议速度 <b className={styles.accent}>{run.config.speed} m/s</b></div><div>预计航段 <b>{run.area ? Math.round((run.area.boundingBox[3] - run.area.boundingBox[1]) * 111320 / run.config.spacing) : '—'}</b></div></div></div></PanelShell><PanelShell icon={Lightbulb} title="绘制提示"><ol className={styles.hintList}><li>点击地图选择顶点，绘制多边形区域。</li><li>矩形工具点击两个对角点即可生成。</li><li>选择编辑工具调整顶点位置。</li><li>重置后可重新规划任务区域。</li></ol></PanelShell></div>
    <TipBar action={<button className={styles.primaryButton} type="button" disabled={!run.area} onClick={() => navigate(3)}>确认区域并生成航线 <ArrowRight size={18} /></button>}>{['区域规划是机群协同任务的基础，面积和形状均由当前地图绘制实时计算。','完成绘制后，可在左侧查看校验结果及规划参数。','仅合法区域可继续生成航线。']}</TipBar>
  </div>;
}

function MissionStep({ run }: { run: SwarmRun }) {
  const { plan, confirmPlan, navigate } = useSwarmStore.getState();
  const [selected, setSelected] = useState('UAV-01');
  const total = run.missions.reduce((sum, item) => sum + item.plannedDistance, 0);
  return <div className={styles.workspace}>
    <div className={styles.leftColumn}><PanelShell icon={Boxes} title="航线分配设置"><div className={styles.infoRows}><div>分配算法 <b>区域均分</b></div><div>自动分区 <b className={styles.success}>● 开启</b></div><div>航线类型 <b>往返式覆盖</b></div><div>航线间距 <b>{run.config.spacing} m</b></div><div>转弯方式 <b>平滑转弯</b></div></div><div className={styles.buttonStack}><button className={styles.primaryButton} type="button" onClick={plan}><Play size={16} />生成航线</button><button type="button" onClick={plan}><RotateCcw size={16} />重新分配</button></div></PanelShell>
    <PanelShell icon={ClipboardCheck} title="任务分配结果" className={styles.fillPanel}><div className={styles.assignmentList}>{run.missions.length ? run.missions.map((mission, index) => <button type="button" key={mission.droneId} onClick={() => setSelected(mission.droneId)} className={selected === mission.droneId ? styles.selectedAssignment : ''}><i style={{ background: mission.assignedColor }} /><strong style={{ color: mission.assignedColor }}>{mission.droneId}</strong><span>{mission.coverageSegments.length} 航段 | {number(mission.plannedDistance)} m</span></button>) : <p className={styles.helper}>点击「生成航线」后显示各机覆盖航段。</p>}</div></PanelShell></div>
    <PanelShell icon={Route} title="航线规划预览" className={styles.mapPanel} action={<span>{run.missions.length} 架任务已规划</span>}><SwarmMap run={run} selected={selected} /></PanelShell>
    <div className={styles.rightColumn}><PanelShell icon={BarChart3} title="任务统计" className={styles.fillPanel}><div className={styles.metrics}><div>总航程<strong>{number(total / 1000)} <small>km</small></strong></div><div>预计总时长<strong>{duration(Math.max(0, ...run.missions.map((item) => item.estimatedDuration)))}</strong></div><div>最小间距<strong>{run.config.safety} <small>m</small></strong></div><div>规划覆盖率<strong>{run.missions.length === run.config.count ? '100%' : '—'}</strong></div></div></PanelShell><PanelShell icon={ShieldCheck} title="航线冲突检查"><div className={styles.infoRows}><div>起飞点间距 <b className={styles.success}>✓ {run.config.safety <= 13 ? '通过' : '需调整'}</b></div><div>航线交叉风险 <b className={run.missions.length ? styles.success : styles.warning}>{run.missions.length ? '✓ 分时起飞' : '待规划'}</b></div><div>区域分配完整 <b className={styles.success}>{run.missions.length === run.config.count ? '✓ 通过' : '待规划'}</b></div><div>时序起飞策略 <b className={styles.success}>已启用</b></div></div></PanelShell></div>
    <TipBar action={<button className={styles.primaryButton} type="button" disabled={run.missions.length !== run.config.count} onClick={confirmPlan}>确认航线并进入下一步 <ArrowRight size={18} /></button>}>{['系统根据区域与航线间距生成往返覆盖航线，不同颜色对应独立无人机任务。','检查任务分配结果和航线冲突情况，调整后可重新生成。','若需修改区域，请返回上一步重新绘制。']}</TipBar>
    <button className={styles.backLink} type="button" onClick={() => navigate(2)}><ArrowLeft size={14} />返回修改区域</button>
  </div>;
}

function CheckStep({ run }: { run: SwarmRun }) {
  const { check, navigate } = useSwarmStore.getState();
  const checks: SwarmCheck[] = run.checks.length ? run.checks : ['机群配置','唯一编号','初始位置','区域规划','航线完整性','任务分配','安全间距','运行时','任务状态','任务参数'].map((name) => ({ name, description: '等待自动检查', status: 'PENDING' }));
  const passed = checks.filter((item) => item.status === 'PASSED').length;
  const ready = passed === checks.length;
  return <div className={styles.workspace}>
    <div className={styles.leftColumn}><PanelShell icon={ClipboardCheck} title="预飞检查清单" className={styles.fillPanel}><div className={styles.checkList}>{checks.map((item) => <div key={item.name} className={styles.checkItem}><span className={item.status === 'PASSED' ? styles.passedIcon : styles.pendingIcon}>{item.status === 'PASSED' ? <Check size={16} /> : '?'}</span><div><strong>{item.name}</strong><small>{item.reason ? `${item.reason}；${item.suggestion}` : item.description}</small></div><span className={item.status === 'PASSED' ? styles.passBadge : styles.waitBadge}>{item.status === 'PASSED' ? '通过' : item.status === 'FAILED' ? '失败' : '待检查'}</span></div>)}</div><button className={styles.primaryButton} type="button" onClick={check}><ShieldCheck size={16} />执行自动检查</button></PanelShell></div>
    <div className={styles.centerColumn}><PanelShell icon={MapPinned} title="检查态势预览" className={styles.mapPanel}><SwarmMap run={run} /></PanelShell><PanelShell icon={Gauge} title="集群飞行控制"><div className={styles.controlBar}><button className={styles.primaryButton} disabled={!ready} onClick={() => navigate(5)} type="button">进入飞行控制 <ArrowRight size={17} /></button><span>检查通过后开启集群起飞</span></div></PanelShell></div>
    <div className={styles.rightColumn}><PanelShell icon={RadioTower} title="机群实时状态" className={styles.fillPanel}><div className={styles.uavCards}>{run.snapshot?.drones.map((drone, index) => <div className={styles.uavCard} key={drone.droneId} style={{ borderLeftColor: droneColor(index) }}><span className={styles.droneGlyph} style={{ color: droneColor(index) }}>✣</span><div><strong style={{ color: droneColor(index) }}>{drone.droneId}</strong><small>高度 {number(drone.altitude)}m · 速度 {number(drone.speed)}m/s</small></div><span className={styles.uavBadge}>{number(drone.battery)}%</span></div>)}</div></PanelShell><PanelShell icon={ShieldCheck} title="启动条件"><div className={styles.readyBox}><CheckCircle2 size={43} /><div><span>检查通过率</span><strong>{Math.round(passed / checks.length * 100)}%</strong><small>{ready ? '可执行集群起飞' : '请先完成全部预飞检查'}</small></div></div></PanelShell></div>
    <TipBar>{['确保所有预飞检查均通过，方可执行集群起飞。','自动检查会校验起飞间距、航线完整性和当前 Mock Runtime 状态。','进入协同飞行后，可按顺序起飞、巡航、暂停和返航。']}</TipBar>
  </div>;
}

function FlightControls({ run }: { run: SwarmRun }) {
  const { command, finish } = useSwarmStore.getState();
  const [confirm, setConfirm] = useState<'return' | 'finish' | null>(null);
  const state = run.snapshot?.status;
  return <><div className={styles.flightControls}><button type="button" disabled={state !== 'READY'} onClick={() => command('takeoff')}>↑<span>集群起飞</span></button><button type="button" disabled={state !== 'HOLDING'} onClick={() => command('startMission')}>▶<span>开始任务</span></button><button className={styles.primaryButton} type="button" disabled={state !== 'RUNNING'} onClick={() => command('pauseMission')}>Ⅱ<span>暂停任务</span></button><button type="button" disabled={state !== 'PAUSED'} onClick={() => command('resumeMission')}>▶<span>继续任务</span></button><button className={styles.returnButton} type="button" disabled={!['RUNNING','PAUSED','HOLDING','TAKING_OFF'].includes(state ?? '')} onClick={() => setConfirm('return')}>⌂<span>集群返航</span></button><button className={styles.dangerButton} type="button" onClick={() => setConfirm('finish')}>■<span>结束实验</span></button></div>
  {confirm && <ConfirmDialog title={confirm === 'return' ? '确认集群返航' : '确认结束实验'} description={confirm === 'return' ? '未完成的区域将计为覆盖缺口，所有无人机安全返航。' : '运行中的无人机会先安全返航并降落，再生成实验结果。'} onCancel={() => setConfirm(null)} onConfirm={() => { if (confirm === 'return') command('returnToHome'); else finish(); setConfirm(null); }} />}</>;
}

function FlightStep({ run }: { run: SwarmRun }) {
  const { command } = useSwarmStore.getState();
  const [selected, setSelected] = useState('UAV-01');
  const snapshot = run.snapshot;
  if (!snapshot) return null;
  return <div className={styles.workspace}>
    <div className={styles.leftColumn}><PanelShell icon={ClipboardList} title="任务概览"><div className={styles.infoRows}><div>任务模式 <b>区域覆盖巡航</b></div><div>无人机数量 <b>{run.config.count} 架</b></div><div>当前状态 <b className={styles.success}>{snapshot.status}</b></div><div>覆盖率 <b className={styles.accent}>{number(snapshot.coverage)}%</b></div><div className={styles.progressTrack}><i style={{ width: `${snapshot.coverage}%` }} /></div><div>总航程 <b>{number(run.missions.reduce((sum, item) => sum + item.plannedDistance, 0) / 1000)} km</b></div><div>已用时 <b>{duration(snapshot.elapsed)}</b></div></div></PanelShell>
    <PanelShell icon={Activity} title="飞行参数曲线" className={styles.fillPanel}><div className={styles.chartLegend}>{snapshot.drones.map((drone, index) => <span key={drone.droneId} style={{ color: droneColor(index) }}>━ {drone.droneId}</span>)}</div><div className={styles.chart}><div className={styles.chartGrid}>{[40,30,20,10,0].map((height) => <span key={height}>{height}</span>)}</div><div className={styles.chartLines}>{snapshot.drones.map((drone, index) => <div key={drone.droneId} style={{ background: droneColor(index), bottom: `${Math.min(drone.altitude, 40) / 40 * 85 + 7}%` }} />)}</div></div><small>实时高度（m）· 地图轨迹和单机遥测以运行时数据为准</small></PanelShell></div>
    <div className={styles.centerColumn}><PanelShell icon={MapPinned} title="协同飞行态势" className={styles.mapPanel}><SwarmMap run={run} selected={selected} /></PanelShell><PanelShell icon={Gauge} title="集群飞行控制"><FlightControls run={run} /></PanelShell></div>
    <div className={styles.rightColumn}><PanelShell icon={RadioTower} title="机群实时状态" className={styles.fillPanel}><div className={styles.uavCards}>{snapshot.drones.map((drone, index) => <button className={`${styles.uavCard} ${selected === drone.droneId ? styles.selectedUav : ''}`} type="button" onClick={() => setSelected(drone.droneId)} key={drone.droneId} style={{ borderLeftColor: droneColor(index) }}><span className={styles.droneGlyph} style={{ color: droneColor(index) }}>✣</span><div><strong style={{ color: droneColor(index) }}>{drone.droneId} <small>SYSID: {drone.sysId}</small></strong><small>进度 {number(drone.progress)}% · 高度 {number(drone.altitude)}m · 电量 {number(drone.battery)}%</small></div><span className={styles.uavBadge}>{drone.state}</span></button>)}</div>{snapshot.drones.filter((drone) => drone.droneId === selected).map((drone) => <div className={styles.selectedDetails} key={drone.droneId}>已完成 {drone.completedSegments} 条扫描航段 · 速度 {number(drone.speed)}m/s · 航点 {drone.waypointIndex}<button type="button" disabled={!['RUNNING','PAUSED','HOLDING'].includes(drone.state)} onClick={() => command('returnToHome', drone.droneId)}>单机返航</button></div>)}</PanelShell><PanelShell icon={BarChart3} title="任务执行统计"><div className={styles.metrics}><div>任务覆盖率<strong>{number(snapshot.coverage)}%</strong></div><div>区域面积<strong>{number((run.area?.area ?? 0) / 10000)} ha</strong></div><div>安全间距<strong>{run.config.safety} m</strong></div><div>已完成面积<strong>{number((run.area?.area ?? 0) * snapshot.coverage / 10000 / 100)} ha</strong></div></div></PanelShell><PanelShell icon={ClipboardList} title="系统事件日志"><div className={styles.logs}>{snapshot.events.slice(-7).map((event, index) => <span key={index}><i />{event}</span>)}</div></PanelShell></div>
    {snapshot.interrupted && <div className={styles.interrupted}>模拟运行已中断，不能继续飞行。请结束本次实验或返回配置重新初始化。</div>}
  </div>;
}

function ResultStep({ run }: { run: SwarmRun }) {
  const { save, newRun } = useSwarmStore.getState();
  const [playback, setPlayback] = useState(100);
  const [saved, setSaved] = useState(false);
  const result = run.result;
  if (!result) return null;
  const replay: SwarmRun = run.snapshot ? { ...run, snapshot: { ...run.snapshot, drones: run.snapshot.drones.map((drone) => { const trajectory = drone.trajectory.slice(0, Math.max(1, Math.ceil(drone.trajectory.length * playback / 100))); return { ...drone, trajectory, position: trajectory.at(-1) ?? drone.homePosition }; }) } } : run;
  const exportReport = () => { const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${run.id}-report.json`; anchor.click(); URL.revokeObjectURL(url); };
  return <div className={styles.workspaceResult}>
    <PanelShell icon={Trophy} title="实验任务完成情况"><div className={styles.resultSummary}><div className={styles.coverageRing} style={{ '--coverage': `${result.coverage}%` } as React.CSSProperties}><div><strong>{number(result.coverage)}%</strong><span>区域覆盖率</span></div></div><div className={styles.metrics}><div>任务区域<strong>{number((run.area?.area ?? 0) / 10000)} ha</strong></div><div>已覆盖面积<strong>{number((run.area?.area ?? 0) * result.coverage / 10000 / 100)} ha</strong></div><div>总航程<strong>{number(result.actualDistance / 1000)} km</strong></div><div>总耗时<strong>{duration(result.elapsed)}</strong></div><div>完成无人机<strong>{run.snapshot?.drones.filter((drone) => drone.state === 'LANDED').length ?? 0} / {run.config.count}</strong></div><div>任务状态<strong className={result.status === 'COMPLETED' ? styles.success : styles.warning}>{result.status}</strong></div></div></div></PanelShell>
    <PanelShell icon={Trophy} title="评分结果"><div className={styles.scoreLayout}><div className={styles.scoreShield}><strong>{result.score}</strong><small>分</small><b>{result.score >= 85 ? '优秀' : result.score >= 60 ? '合格' : '待改进'}</b></div><div className={styles.scoreItems}>{[['机群配置与安全着陆', run.snapshot?.drones.every((drone) => drone.state === 'LANDED') ? 10 : 0, 10], ['规划与航线执行', result.status === 'COMPLETED' ? 20 : 0, 20], ['区域覆盖率', Math.round(result.coverage * 0.7), 70]].map(([title, points, maximum]) => <div key={String(title)}><span>{title}</span><b>{points} / {maximum}</b><i><em style={{ width: `${Number(points) / Number(maximum) * 100}%` }} /></i></div>)}</div></div></PanelShell>
    <PanelShell icon={Play} title="飞行轨迹回放"><SwarmMap run={replay} /><div className={styles.playback}><span>{duration(result.elapsed * playback / 100)} / {duration(result.elapsed)}</span><input aria-label="轨迹回放进度" type="range" min="0" max="100" value={playback} onChange={(event) => setPlayback(Number(event.target.value))} /><span>{playback}%</span></div></PanelShell>
    <PanelShell icon={ClipboardList} title="实验记录与报告"><div className={styles.infoRows}><div>实验编号 <b>{run.id.slice(0, 24)}</b></div><div>开始时间 <b>{new Date(run.createdAt).toLocaleString('zh-CN')}</b></div><div>结束时间 <b>{new Date(result.completedAt).toLocaleString('zh-CN')}</b></div><div>实验模式 <b>Mock 模式</b></div><div>无人机数量 <b>{run.config.count} 架</b></div><div>实验状态 <b className={result.status === 'COMPLETED' ? styles.success : styles.warning}>{result.status}</b></div></div><h3>关键事件记录</h3><div className={styles.logs}>{result.events.slice(-5).map((event, index) => <span key={index}><i />{event}</span>)}</div>{result.feedback.map((message) => <p className={styles.helper} key={message}>{message}</p>)}</PanelShell>
    <div className={styles.resultActions}><button className={styles.primaryButton} type="button" onClick={() => { save(); setSaved(true); }}><ClipboardCheck size={17} />{saved ? '记录已保存' : '保存实验记录'}</button><button className={styles.primaryButton} type="button" onClick={exportReport}><Download size={17} />导出报告</button><button className={styles.primaryButton} type="button" onClick={newRun}><RotateCcw size={17} />重新实验</button><Link to="/experiments"><ArrowLeft size={17} />返回实验中心</Link></div>
  </div>;
}

export function SwarmExperimentPage() {
  const { run, error, newRun, resume, navigate, leave } = useSwarmStore();
  const [active, setActive] = useState(false);
  const cleanupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { if (cleanupTimer.current) clearTimeout(cleanupTimer.current); return () => { cleanupTimer.current = setTimeout(() => leave(), 0); }; }, [leave]);
  if (!run || !active) return <div className={styles.page}><div className={styles.experimentHeading}><div className={styles.headingIcon}><ClipboardList size={28} /></div><div><h1>实验二：多无人机集群区域规划与协同飞行</h1><p>通过多无人机的区域覆盖任务，学习机群任务分配、航线规划与协同起降，掌握集群作业的基本方法。</p></div></div><div className={styles.entry}><PanelShell icon={Boxes} title="实验介绍"><h2>从区域规划到协同巡航</h2><p>配置 2–5 架 Iris，绘制任务区域，生成往返覆盖航线并执行预飞检查及安全飞行。所有操作均在 Mock 仿真环境中完成。</p><div className={styles.entryStages}>{names.map((name, index) => <div key={name}><span>{index + 1}</span>{name}</div>)}</div><div className={styles.actions}><button className={styles.primaryButton} type="button" onClick={() => { if (run && !run.result && !window.confirm('开始新实验将替换当前未完成的实验草稿，是否继续？')) return; newRun(); setActive(true); }}>开始新实验 <ArrowRight size={17} /></button>{run && !run.result && <button type="button" onClick={() => { resume(); setActive(true); }}>恢复未完成实验</button>}{run?.result && <button type="button" onClick={() => setActive(true)}>查看上次结果</button>}</div><p>本地已保存 {savedSwarmRecords().length} 条实验二记录。</p></PanelShell></div></div>;
  const allowed = (step: number) => step === 1 || step === 2 && !!run.snapshot || step === 3 && !!run.area || step === 4 && run.confirmed || step === 5 && run.checks.length > 0 && run.checks.every((item) => item.status === 'PASSED') || step === 6 && !!run.result;
  const completed = (step: number) => step < run.step && (step !== 2 || !!run.area) && (step !== 3 || run.confirmed) && (step !== 4 || run.checks.length > 0 && run.checks.every((item) => item.status === 'PASSED'));
  return <div className={styles.page}><div className={styles.experimentHeading}><div className={styles.headingIcon}><ClipboardList size={28} /></div><div><h1>实验二：多无人机集群区域规划与协同飞行</h1><p>通过多无人机的区域覆盖任务，学习机群任务分配、航线规划与协同起降，掌握集群作业的基本方法。</p></div></div>
    <nav className={styles.stepper} aria-label="实验步骤">{names.map((title, index) => <button key={title} type="button" disabled={!allowed(index + 1) || index + 1 === run.step} className={index + 1 === run.step ? styles.currentStep : completed(index + 1) ? styles.completedStep : ''} onClick={() => navigate(index + 1)}><span>{completed(index + 1) ? <Check size={18} /> : index + 1}</span>{title}</button>)}</nav>
    <div className={styles.content}>{error && <div role="alert" className={styles.error}>{error}<button type="button" onClick={() => useSwarmStore.getState().clearError()}>关闭</button></div>}{run.snapshot?.interrupted && run.step !== 5 && run.step !== 6 && <div className={styles.error}>上次模拟运行已中断，请重新初始化机群。<button type="button" onClick={() => useSwarmStore.getState().finish()}>中断结束并查看结果</button></div>}
      {run.step === 1 && <ConfigStep run={run} />}{run.step === 2 && <AreaStep run={run} />}{run.step === 3 && <MissionStep run={run} />}{run.step === 4 && <CheckStep run={run} />}{run.step === 5 && <FlightStep run={run} />}{run.step === 6 && <ResultStep run={run} />}
    </div></div>;
}
