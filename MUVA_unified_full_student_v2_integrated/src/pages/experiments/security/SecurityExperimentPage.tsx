import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Check, Crosshair, Radio, RotateCcw, ShieldAlert, Siren, Waypoints, Play, Power, PlaneLanding, MoveUp, MoveDown, Satellite, Undo2, Trash2, Eye, Plus, X, MapPin } from 'lucide-react';
import { FlightSceneViewport, type RoutePlannerMapState } from '../../../components/map/FlightSceneViewport';
import { rebaseMapCoordinates } from '../../../domain/flightMap';
import { experiment1SceneAssets } from '../../../domain/trainingScenes';
import { useSecurityExperimentStore } from '../../../stores/securityExperimentStore';
import { services } from '../../../services/serviceRegistry';
import type { SecurityRangeSnapshot } from '../../../services/contracts';
import type { RouteDraftWaypoint } from '../../../types/mission';
import styles from './SecurityExperimentPage.module.css';

export function SecurityExperimentPage() {
  const [selectedAttack, setSelectedAttack] = useState<'data-stream' | 'link-interference'>('data-stream');
  const [range, setRange] = useState<SecurityRangeSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [attackState, setAttackState] = useState<'idle' | 'complete' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [routeWaypoints, setRouteWaypoints] = useState<RouteDraftWaypoint[]>([]);
  const [routeDraftActive, setRouteDraftActive] = useState(false);
  const [routePreview, setRoutePreview] = useState(false);
  const [injectionLatitude, setInjectionLatitude] = useState('');
  const [injectionLongitude, setInjectionLongitude] = useState('');
  const [injectionAltitude, setInjectionAltitude] = useState('6');
  const executeSimulationMotorStop = useSecurityExperimentStore((state) => state.executeSimulationMotorStop);
  const snapshot = range?.vehicle;
  const home = snapshot?.home;
  const telemetry = snapshot?.telemetry;
  const cityCenter = experiment1SceneAssets.city!.center;
  const actualHome = home?.valid ? { latitude: home.latitude, longitude: home.longitude } : null;
  const positionValid = !!home?.valid && Number.isFinite(telemetry?.latitude) && Number.isFinite(telemetry?.longitude);
  const fresh = !!range?.active && !!snapshot?.connection.connected && snapshot.connection.lastHeartbeatAgeMs !== null && snapshot.connection.lastHeartbeatAgeMs < 3000;
  const armed = !!snapshot?.vehicle.armed;
  const airborne = fresh && armed && (telemetry?.altitude ?? 0) > 1;
  const landed = fresh && !armed && Math.abs(telemetry?.altitude ?? 999) < 0.5;
  const takeoffReady = fresh && range?.runtime.gps === '3D FIX' && range?.runtime.ekf === 'HEALTHY' && !!home?.valid && !armed;
  const routeReady = selectedAttack === 'link-interference' && routeDraftActive && landed && positionValid && routePreview && routeWaypoints.length >= 2;
  const attacks = [
    { id: 'data-stream' as const, name: '指令注入', detail: '飞行状态异常响应', icon: Activity, available: true },
    { id: 'link-interference' as const, name: '航点篡改', detail: '自定义航线 · 空中偏移', icon: Waypoints, available: true },
    { id: 'navigation-spoofing' as const, name: '导航欺骗', detail: '功能预留', icon: Satellite, available: false },
    { id: 'command-injection' as const, name: '数据流攻击', detail: '功能预留', icon: Waypoints, available: false },
    { id: 'telemetry-replay' as const, name: '遥测重放', detail: '功能预留', icon: Radio, available: false },
  ];

  const refresh = useCallback(async () => {
    try { setRange(await services.security.getRangeStatus()); }
    catch (error) { setMessage(error instanceof Error ? error.message : '无法读取靶场状态'); }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function perform(action: () => Promise<unknown>, success: string): Promise<void> {
    if (busy) return;
    setBusy(true); setMessage(''); setAttackState('idle');
    try { await action(); setMessage(success); setAttackState('complete'); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : '操作失败'); setAttackState('error'); await refresh(); }
    finally { setBusy(false); }
  }
  function startAttack(): void {
    if (selectedAttack === 'data-stream') {
      void perform(executeSimulationMotorStop, '攻击指令已发送，请观察仿真中的飞行状态变化。');
      return;
    }
    setMessage('航点篡改需要先执行原航线，再在地图下方设置注入目标。');
  }

  const planner: RoutePlannerMapState = {
    visible: routeDraftActive && selectedAttack === 'link-interference', showToolbar: false,
    editable: routeDraftActive && positionValid && !busy && (landed || (airborne && selectedAttack === 'link-interference')),
    phase: routeWaypoints.length ? 'PLANNING' : 'IDLE',
    waypoints: actualHome ? routeWaypoints.map((point) => rebaseMapCoordinates(point, actualHome, cityCenter)) : routeWaypoints,
    altitudeMeters: 6, maxAltitudeMeters: 10, vehicleReady: landed && positionValid && routeWaypoints.length >= 2, error: null,
    onAddWaypoint: (latitude, longitude) => {
      if (!actualHome) return;
      const waypoint = rebaseMapCoordinates({ latitude, longitude }, cityCenter, actualHome);
      if (airborne && selectedAttack === 'link-interference') {
        setInjectionLatitude(waypoint.latitude.toFixed(7)); setInjectionLongitude(waypoint.longitude.toFixed(7));
        setMessage('已从地图选定注入目标；确认高度后点击“注入并改飞目标”。');
        return;
      }
      if (landed && routeWaypoints.length < 6) {
        setRouteWaypoints((items) => [...items, { id: Date.now(), ...waypoint }]); setRoutePreview(false);
      }
    },
    onUndo: () => { setRouteWaypoints((items) => items.slice(0, -1)); setRoutePreview(false); },
    onClear: () => { setRouteWaypoints([]); setRoutePreview(false); }, onCancel: () => { setRouteWaypoints([]); setRoutePreview(false); },
    onAltitudeChange: () => undefined, onExecute: () => { setRoutePreview(true); setMessage('原始航线已预览，确认后上传并执行。'); },
  };
  const context = useMemo(() => home?.valid ? ({
    contextId: 'security-range-city', sceneName: '靶场地图', coordinateMode: 'scene-relative' as const,
    configuredHome: cityCenter, sceneCenter: cityCenter, actualHome: cityCenter,
    telemetryReady: fresh, savedView: null,
    onViewChange: () => undefined, mapError: null, onRetryMap: () => { void refresh(); }, initialZoom: 17.2,
  }) : undefined, [home?.valid, home?.latitude, home?.longitude, fresh, refresh]);
  const north = home?.valid && telemetry ? (telemetry.latitude - home.latitude) * 111111 : 0;
  const east = home?.valid && telemetry ? (telemetry.longitude - home.longitude) * 111111 * Math.cos(home.latitude * Math.PI / 180) : 0;
  const displayPosition = actualHome && telemetry ? rebaseMapCoordinates({ latitude: telemetry.latitude, longitude: telemetry.longitude }, actualHome, cityCenter) : null;
  const path = (snapshot?.track ?? []).map((point, index) => ({ ...rebaseMapCoordinates(point, actualHome ?? cityCenter, cityCenter), altitude: point.altitude, timestamp: point.timestamp ?? index,
    north: home?.valid ? (point.latitude - home.latitude) * 111111 : 0,
    east: home?.valid ? (point.longitude - home.longitude) * 111111 * Math.cos(home.latitude * Math.PI / 180) : 0 }));

  return <main className={styles.page}>
    <header className={styles.header}>
      <div><div className={styles.eyebrow}>EXPERIMENT 04 / SECURITY RANGE</div><h1><ShieldAlert size={25} />安全攻防对抗</h1><p>独立 Gazebo / SITL 靶场，不依赖实验一飞控状态</p></div>
      <div className={styles.status}><span data-live={fresh}><i />{fresh ? '靶场遥测在线' : range?.active ? '等待飞控心跳' : '靶场未启动'}</span><b><Radio size={15} />{armed ? '已解锁' : '未解锁'}</b></div>
    </header>

    <div className={styles.rangeBar}>
      <span className={styles.sectionLabel}>{selectedAttack === 'data-stream' ? '数据流攻击场景' : '航点篡改场景'}</span>
      <span className={styles.runtimeState}><i data-active={range?.runtime.gazebo === 'RUNNING'} />Gazebo {range?.runtime.gazebo === 'RUNNING' ? '运行中' : '未运行'}</span>
      <span className={styles.runtimeState}><i data-active={range?.runtime.ardupilotSitl === 'RUNNING'} />SITL {range?.runtime.ardupilotSitl === 'RUNNING' ? '运行中' : '未运行'}</span>
      <span className={styles.runtimeState}><i data-active={fresh} />{fresh ? '遥测在线' : '等待遥测'}</span>
    </div>

    <div className={styles.workspace}>
      <aside className={styles.attackLibrary}>
        <div className={styles.sectionLabel}>攻击方式 <span>01 / 05</span></div>
        {attacks.map(({ id, name, detail, icon: Icon, available }) => <button key={id} className={`${styles.attackItem} ${!available ? styles.attackItemReserved : ''}`} disabled={!available} aria-pressed={selectedAttack === id} onClick={() => { if (available) { setSelectedAttack(id as 'data-stream' | 'link-interference'); setAttackState('idle'); setMessage(''); } }}>
          <span className={styles.attackIcon}><Icon size={18} /></span><span><b>{name}</b><small>{detail}</small></span><i />
        </button>)}
        <div className={styles.impact}><AlertTriangle size={16} /><span><b>当前攻击</b><small>{selectedAttack === 'link-interference' ? '航点篡改：先执行原航线，再从地图下方注入新的飞行目标。' : '数据流攻击：完成起飞后，在地图下方开始攻击。'}</small></span></div>
      </aside>

      <section className={styles.mainArea}>
        <div className={styles.mapHeader}><div><span className={styles.sectionLabel}>仿真态势</span><b>实时飞行地图</b></div><div className={styles.mapTags}><span>GPS / SITL</span><span>真实坐标 · Iris 单机</span></div></div>
        <div className={styles.mapCanvas}>
          {positionValid && telemetry && home && displayPosition && <FlightSceneViewport altitudeMeters={telemetry.altitude} armed={armed} currentTask="安全攻防目标" speedMetersPerSecond={telemetry.groundSpeed}
            latitude={displayPosition.latitude} longitude={displayPosition.longitude} home={cityCenter} north={north} east={east}
            yaw={telemetry.yaw} mode={snapshot?.vehicle.mode ?? 'UNKNOWN'} flightPath={path} routePlanner={planner} sceneContext={context} />}
          {(!range?.active || !positionValid || !telemetry || !home) && <div className={styles.mapEmpty}><Crosshair size={24} /><b>{range?.active ? '等待靶场 HOME 与 GPS 定位' : '靶场尚未启动'}</b><span>{range?.active ? '确认 SITL 心跳与 GPS 数据正常后，独立地图将显示飞行器。' : '先启动本实验专属 Gazebo / SITL，再进行起飞和攻击操作。'}</span></div>}
          <div className={styles.mapLegend}><span><i className={styles.homeMark} />靶场 HOME</span><span><i className={styles.vehicleMark} />无人机</span><span><i className={styles.trackMark} />飞行轨迹</span></div>
        </div>

        <div className={styles.controlBar}>
          <div className={styles.target}><span className={styles.targetGlyph}><Crosshair size={18} /></span><span><small>攻击目标</small><b>Iris · 靶场单机</b></span><span className={`${styles.linkState} ${fresh ? styles.connected : ''}`}><i />{fresh ? '在线' : '离线'}</span></div>
        </div>
        <section className={styles.sceneAttack} aria-label="当前场景攻击操作">
          <div className={styles.panelHeading}><Siren size={16} /><b>{selectedAttack === 'link-interference' ? '航点篡改操作' : '数据流攻击操作'}</b><span>场景控制</span></div>
          {selectedAttack === 'data-stream' ? <button className={styles.launch} disabled={busy || !airborne} onClick={startAttack}>
            {busy ? <Activity size={17} /> : <Siren size={17} />}开始攻击
          </button> : <>
            <p>先在右侧创建并执行原航线。无人机起飞后，可直接点击上方地图选取新目标，或手动填写坐标。</p>
            <div className={styles.injectionFields}>
              <label>目标纬度<input inputMode="decimal" value={injectionLatitude} onChange={(event) => setInjectionLatitude(event.target.value)} placeholder="例如 34.1252000" /></label>
              <label>目标经度<input inputMode="decimal" value={injectionLongitude} onChange={(event) => setInjectionLongitude(event.target.value)} placeholder="例如 108.8291000" /></label>
              <label>相对高度 (m)<input type="number" min="0.5" max="10" step="0.5" value={injectionAltitude} onChange={(event) => setInjectionAltitude(event.target.value)} /></label>
              <button className={styles.routeExecute} disabled={busy || !airborne || !injectionLatitude || !injectionLongitude} onClick={() => {
                const latitude = Number(injectionLatitude), longitude = Number(injectionLongitude), altitude = Number(injectionAltitude);
                if (![latitude, longitude, altitude].every(Number.isFinite)) { setMessage('请输入有效的注入坐标和高度。'); setAttackState('error'); return; }
                void perform(() => services.security.injectRangeWaypoint({ latitude, longitude, altitude }), '航点已注入：飞控进入 GUIDED 并开始飞向目标点。');
              }}><MapPin size={15} />注入并改飞目标</button>
            </div>
            <small className={styles.routeStatus}>{airborne ? '注入后 AUTO 原航线会被 GUIDED 目标飞行接管。' : '等待原航线执行并确认无人机离地。'}</small>
          </>}
        </section>
        {message && <div role={attackState === 'error' ? 'alert' : 'status'} className={`${styles.feedback} ${attackState === 'error' ? styles.feedbackError : ''}`}>
          {attackState === 'complete' ? <Check size={16} /> : <AlertTriangle size={16} />}{message}
          <button title="清除提示" aria-label="清除提示" onClick={() => { setAttackState('idle'); setMessage(''); }}><RotateCcw size={14} /></button>
        </div>}
      </section>

      <aside className={styles.telemetry}>
        <section className={styles.attackSetup} aria-label={selectedAttack === 'data-stream' ? '数据流攻击飞行控制' : '航点篡改飞行控制'}>
          <div className={styles.panelHeading}><Play size={16} /><b>{selectedAttack === 'data-stream' ? '数据流攻击 · 飞行准备' : '航点篡改 · 飞行准备'}</b></div>
          <button className={styles.launch} disabled={busy} onClick={() => void perform(async () => {
            const status = await services.security.startRange();
            if (status.runtime.gazebo !== 'RUNNING' || status.runtime.ardupilotSitl !== 'RUNNING') {
              throw new Error(`仿真未启动成功：Gazebo ${status.runtime.gazebo}，SITL ${status.runtime.ardupilotSitl}。请检查 Gateway 仿真日志。`);
            }
            setRange(status);
          }, 'Gazebo 与 SITL 均已启动；等待飞控遥测就绪。')}>
            {busy ? <Activity size={15} /> : <Play size={15} />}{busy ? '正在启动仿真…' : '启动仿真'}
          </button>
          <button className={styles.rangeButton} disabled={busy || !takeoffReady} title={!range?.active ? '请先启动本实验靶场' : !fresh ? '等待飞控心跳在线' : !takeoffReady ? '等待 GPS 3D 定位、IMU/EKF 健康和 HOME 建立，并确认未解锁' : undefined} onClick={() => void perform(() => services.security.takeoffRange(6), `${selectedAttack === 'data-stream' ? '数据流攻击' : '航点篡改'}场景起飞指令已发送。`)}><Play size={15} />本场景起飞至 6 m</button>
          {selectedAttack === 'data-stream' && <div className={styles.rangeActions}>
            <button className={styles.rangeButton} disabled={busy || !airborne} title={!airborne ? '起飞并确认高度超过 1 米后可操作' : undefined} onClick={() => void perform(() => services.security.moveRange('forward', 2), '前进指令已发送。')}><MoveUp size={15} />前进</button>
            <button className={styles.rangeButton} disabled={busy || !airborne} title={!airborne ? '起飞并确认高度超过 1 米后可操作' : undefined} onClick={() => void perform(() => services.security.moveRange('backward', 2), '后退指令已发送。')}><MoveDown size={15} />后退</button>
          </div>}
          <div className={styles.rangeActions}>
            <button className={styles.rangeButton} disabled={busy || !airborne} title={!airborne ? '无人机离地且遥测在线后可降落' : undefined} onClick={() => void perform(() => services.security.landRange(), '降落模式已设置，请等待落地并锁定。')}><PlaneLanding size={15} />降落</button>
            <button className={styles.rangeButton} disabled={busy || !range?.active || !landed} title={!range?.active ? '当前靶场未运行' : !landed ? '确认遥测在线、已锁定且高度低于 0.5 米后可关闭' : undefined} onClick={() => void perform(() => services.security.stopRange(), '当前场景靶场已安全关闭。')}><Power size={15} />关闭仿真</button>
          </div>
          <small className={styles.routeStatus}>{!range?.active ? '先启动靶场；启动后此处保留攻击一的起飞、前进、后退、降落和关闭控制。' : !fresh ? '靶场进程已启动，等待飞控遥测；飞行控制暂不可用。' : !takeoffReady && !airborne ? '等待 GPS 3D 定位、EKF 健康和 HOME 建立后即可起飞。' : selectedAttack === 'data-stream' ? '攻击一：起飞后可前进、后退，并在地图下方开始攻击。' : '攻击二：起飞前规划并执行原航线，空中可在地图下方注入航点。'}</small>
        </section>
        <div className={styles.sectionLabel}>靶场遥测 <span>LIVE</span></div>
        <div className={styles.metric}><small>飞行状态</small><b className={armed ? styles.metricWarn : ''}>{armed ? '空中 / 已解锁' : '地面 / 未解锁'}</b></div>
        <div className={styles.metric}><small>相对高度</small><b>{(telemetry?.altitude ?? 0).toFixed(1)} <i>m</i></b></div>
        <div className={styles.metric}><small>地速</small><b>{(telemetry?.groundSpeed ?? 0).toFixed(1)} <i>m/s</i></b></div>
        <div className={styles.metric}><small>飞行模式</small><b>{snapshot?.vehicle.mode ?? 'UNKNOWN'}</b></div>
        <div className={styles.metric}><small>电池余量</small><b>{(telemetry?.battery ?? 0).toFixed(0)} <i>%</i></b></div>
        {selectedAttack === 'link-interference' && <section className={styles.routePanel} aria-label="航点篡改原始航线规划">
          <div className={styles.panelHeading}><Waypoints size={16} /><b>航线规划</b>{routeDraftActive && <span>{routeWaypoints.length}/6 航点</span>}</div>
          {!routeDraftActive ? <>
            <p>{landed ? '当前可规划：在地图上依次点击添加原始航点。执行航线后起飞，地图点击将改为选择攻击注入目标。' : '航线必须在起飞前规划。请先启动靶场，等待遥测在线并确认无人机落地、锁定。'}</p>
            <button className={styles.routeExecute} title={!fresh ? '等待飞控心跳在线' : !landed ? '请在地面并锁定后规划航线' : undefined} disabled={busy || !landed || !positionValid} onClick={() => { setRouteWaypoints([]); setRoutePreview(false); setRouteDraftActive(true); setMessage('航线草稿已创建；请在地图上点击添加航点。'); }}><Plus size={15} />新建航线</button>
          </> : <>
            <p className={styles.draftName}>当前编辑：实验四航线草稿</p>
            <p>{landed ? `在地图上点击添加航点（${routeWaypoints.length}/6）；至少 2 个航点后可预览。` : '航线草稿已保留。请先降落并锁定，再继续编辑。'}</p>
            <div className={styles.routeActions}>
              <button className={styles.rangeButton} title="撤销上一个航点" aria-label="撤销上一个航点" disabled={busy || !landed || routeWaypoints.length === 0} onClick={planner.onUndo}><Undo2 size={15} /></button>
              <button className={styles.rangeButton} title="清空航点" aria-label="清空航点" disabled={busy || !landed || routeWaypoints.length === 0} onClick={planner.onClear}><Trash2 size={15} /></button>
              <button className={styles.rangeButton} disabled={busy || !landed || routeWaypoints.length < 2} onClick={() => { setRoutePreview(true); setMessage('原始航线预览已显示在地图上。'); }}><Eye size={15} />预览路线</button>
              <button className={styles.rangeButton} title="取消当前航线" aria-label="取消当前航线" disabled={busy} onClick={() => { setRouteDraftActive(false); setRouteWaypoints([]); setRoutePreview(false); }}><X size={15} /></button>
            </div>
            <button className={styles.routeExecute} disabled={busy || !routeReady} onClick={() => void perform(() => services.security.executeRangeMission(routeWaypoints), '原始航线已上传并启动；起飞后可在场景下方注入新目标。')}><Play size={15} />上传并执行原航线</button>
          </>}
          <small className={styles.routeStatus}>{!fresh ? '等待靶场遥测在线' : !landed ? '规划仅限起飞前：请降落并锁定' : routeDraftActive && routeWaypoints.length < 2 ? '点击地图添加至少 2 个航点' : routePreview ? '路线预览已就绪' : routeDraftActive ? '航线已规划，点击预览确认' : '尚未创建航线'}</small>
        </section>}
      </aside>
    </div>
  </main>;
}
