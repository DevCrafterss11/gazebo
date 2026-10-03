import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import {
  Activity,
  AlertTriangle,
  BatteryMedium,
  Check,
  ChevronDown,
  CircleGauge,
  Crosshair,
  Crosshair as CrosshairIcon,
  Eraser,
  Gauge,
  Home,
  Layers3,
  ListChecks,
  LocateFixed,
  LockKeyhole,
  Map as MapIcon,
  MapPin,
  MapPinPlus,
  Menu,
  MousePointer2,
  Navigation,
  Pause,
  Pencil,
  PlaneLanding,
  PlaneTakeoff,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Route,
  Satellite,
  Settings2,
  ShieldAlert,
  Signal,
  SlidersHorizontal,
  Terminal,
  Trash2,
  UnlockKeyhole,
  Waypoints,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { getGateway, HomePosition, MonitorSnapshot, sendGatewayCommand, StatusMessage, Telemetry, TrackPoint, useMavlinkMonitor, useVehicleGateway } from "./gateway";

type View = "flight" | "mission" | "system";
type CommandState = "idle" | "pending" | "success" | "error";
type MissionSyncState = "unknown" | "dirty" | "verified";
type FlightAction = "takeoff" | "hold" | "rtl" | "land" | "brake";
type MissionCommand = "TAKEOFF" | "WAYPOINT" | "LOITER_TIME" | "RTL" | "LAND";
type MapPickTarget = "new" | "editor" | "home";

type MissionPoint = {
  id: number;
  label: string;
  command: MissionCommand;
  altitude: number;
  coordinates: [number, number];
  param1: number;
  param2: number;
  param3: number;
  param4: number;
};

type MissionDraft = MissionPoint;

type MissionApiItem = {
  seq: number;
  command: string;
  frame: number;
  latitude: number;
  longitude: number;
  altitude: number;
  param1: number;
  param2: number;
  param3: number;
  param4: number;
  current: number;
  autocontinue: number;
};

type ApiResponse<T> = { ok: boolean; result: T };

type MissionDownloadResult = {
  count: number;
  verified: boolean;
  verifiedAt: number | null;
  missionHash: string | null;
  validationError: string | null;
  items: MissionApiItem[];
};

const HOME: [number, number] = [108.9398, 34.3416];
let missionIdSeed = 1_000;

function nextMissionId() {
  missionIdSeed += 1;
  return Date.now() + missionIdSeed;
}

const initialMission: MissionPoint[] = [
  { id: 1, label: "起飞点", command: "TAKEOFF", altitude: 12, coordinates: HOME, param1: 0, param2: 0, param3: 0, param4: 0 },
  { id: 2, label: "返航", command: "RTL", altitude: 0, coordinates: HOME, param1: 0, param2: 0, param3: 0, param4: 0 },
];

const modes = ["STABILIZE", "ALT_HOLD", "LOITER", "GUIDED", "AUTO", "RTL", "LAND"];
const missionCommands: { value: MissionCommand; label: string; description: string }[] = [
  { value: "TAKEOFF", label: "起飞", description: "从 Home 点爬升到目标高度" },
  { value: "WAYPOINT", label: "航点", description: "飞行器经过并继续下一个点" },
  { value: "LOITER_TIME", label: "定点悬停", description: "到达位置后悬停指定时间" },
  { value: "RTL", label: "返航", description: "返回飞控记录的 Home 点" },
  { value: "LAND", label: "降落", description: "在指定位置执行降落" },
];

function missionCommandLabel(command: MissionCommand) {
  return missionCommands.find((item) => item.value === command)?.label ?? command;
}

function isTerminalCommand(command: MissionCommand) {
  return command === "RTL" || command === "LAND";
}

function missionItemsToPoints(downloaded: MissionApiItem[]): MissionPoint[] {
  return downloaded.map((item) => ({
    id: item.seq + 1,
    label: item.command === "TAKEOFF" ? "起飞点" : item.command === "RTL" ? "返航" : item.command === "LAND" ? "降落" : `航点 ${item.seq}`,
    command: item.command as MissionCommand,
    altitude: item.altitude,
    coordinates: item.command === "RTL" || !Number.isFinite(item.latitude) || !Number.isFinite(item.longitude) ? HOME : [item.longitude, item.latitude],
    param1: item.param1,
    param2: item.param2,
    param3: item.param3,
    param4: item.param4,
  }));
}

function createMissionDraft(coordinates: [number, number], command: MissionCommand = "WAYPOINT", altitude = 25): MissionDraft {
  return {
    id: nextMissionId(),
    label: command === "WAYPOINT" ? "新航点" : missionCommandLabel(command),
    command,
    altitude: command === "TAKEOFF" ? 12 : altitude,
    coordinates,
    param1: command === "LOITER_TIME" ? 30 : 0,
    param2: 0,
    param3: 0,
    param4: 0,
  };
}

function distanceMeters(from: [number, number], to: [number, number]) {
  const earthRadius = 6_371_000;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(to[1] - from[1]);
  const longitudeDelta = radians(to[0] - from[0]);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from[1])) * Math.cos(radians(to[1])) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(a));
}

function IconButton({
  label,
  children,
  active = false,
  onClick,
  disabled = false,
}: {
  label: string;
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className={`icon-button ${active ? "is-active" : ""}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function ExperimentOneDashboard({
  gateway,
  telemetry,
  armed,
  onOpenLegacy,
}: {
  gateway: ReturnType<typeof useVehicleGateway>;
  telemetry: Telemetry;
  armed: boolean;
  onOpenLegacy: () => void;
}) {
  const [step, setStep] = useState(1);
  const [vehicle, setVehicle] = useState("Iris 四旋翼");
  const [modal, setModal] = useState<string | null>(null);
  const [scene, setScene] = useState("校园环境");
  const [launching, setLaunching] = useState(false);
  const [launchMessage, setLaunchMessage] = useState("");
  const [controller, setController] = useState("ArduPilot");
  const [sensors, setSensors] = useState(["GPS", "IMU", "Compass", "Barometer"]);
  const [takeoffAltitude, setTakeoffAltitude] = useState(10);
  const [maxSpeed, setMaxSpeed] = useState(5);
  const vehicles = [
    ["Iris 四旋翼", "450mm · 0.6kg · 8m/s", "适合基础飞行教学"],
    ["X500 四旋翼", "500mm · 1.0kg · 20m/s", "适合复杂任务演练"],
    ["Hexa 六旋翼", "650mm · 1.5kg · 16m/s", "适合高稳定性实验"],
  ];
  const steps = ["无人机选择", "飞控选择", "传感器配置", "飞行参数", "场景选择", "任务模板", "确认创建"];
  const openStep = (index: number) => { setStep(index); setModal(null); };
  return (
    <div className="experiment-shell">
      <header className="experiment-topbar">

        、


        
        <div className="experiment-brand"><span className="experiment-brand-mark">✦</span><strong>MUVA</strong><b>无人机教学与安全实验平台</b></div>
        <div className="experiment-top-actions"><span className="sim-pill">仿真环境 · 虚拟</span><span>⌕</span><span>◉ admin⌄</span></div>
      </header>
      <div className="experiment-body">
        <aside className="experiment-nav">
          <button className="is-active"><Navigation size={18} />飞行配置与操作</button>
          <button onClick={() => setModal("实验二：集群飞行控制")}><Activity size={18} />集群飞行控制</button>
          <button onClick={() => setModal("实验三：任务协同")}><Waypoints size={18} />任务协同</button>
          <button onClick={() => setModal("实验四：安全攻防对抗")}><ShieldAlert size={18} />安全攻防对抗 <em>限演示</em></button>
          <button onClick={() => setModal("实验五：自定义安全对抗")}><Settings2 size={18} />自定义安全对抗 <em>限演示</em></button>
          <button onClick={onOpenLegacy}><ListChecks size={18} />经典飞行控制台</button>
        </aside>
        <main className={`experiment-main experiment-step-${step}`}>
          <section className="experiment-heading"><div><small>实验一 · 基础实验</small><h1>无人机配置与基础飞行操作</h1></div><button onClick={() => setModal("实验说明")}>实验说明⌄</button></section>
          <div className="experiment-steps">{steps.map((label, index) => <button key={label} className={step === index + 1 ? "is-current" : step > index + 1 ? "is-done" : ""} onClick={() => openStep(index + 1)}><i>{index + 1}</i><span>{label}</span></button>)}</div>
          {step === 2 && <section className="exp-panel inline-config"><div className="exp-title"><span>选择飞控</span><small>当前项目默认 ArduPilot，PX4 作为兼容预留</small></div><div className="choice-row">{["ArduPilot","PX4"].map(item=><button key={item} className={controller===item?"selected":""} onClick={()=>setController(item)}><strong>{controller===item?"✓ ":""}{item}</strong><small>{item==="ArduPilot"?"Copter SITL · 当前可用":"兼容方案 · 待接入"}</small></button>)}</div><button className="blue-button" onClick={()=>openStep(3)}>下一步：传感器配置 →</button></section>}
          {step === 3 && <section className="exp-panel inline-config"><div className="exp-title"><span>传感器配置</span><small>建议启用 GPS、IMU、磁罗盘、气压计</small></div><div className="choice-row">{["GPS","IMU","Compass","Barometer","Rangefinder"].map(item=><button key={item} className={sensors.includes(item)?"selected":""} onClick={()=>setSensors(v=>v.includes(item)?v.filter(x=>x!==item):[...v,item])}><strong>{sensors.includes(item)?"✓ ":""}{item}</strong><small>{item==="Rangefinder"?"可选近地测距":"起飞检查必需/推荐"}</small></button>)}</div><button className="blue-button" onClick={()=>openStep(4)}>下一步：飞行参数 →</button></section>}
          {step === 4 && <section className="exp-panel inline-config"><div className="exp-title"><span>飞行参数</span><small>输入范围：起飞高度 2–120m，速度 1–20m/s；建议高度 5–30m、速度 ≤8m/s</small></div><div className="param-grid"><label>起飞高度（m）<input type="number" min="2" max="120" value={takeoffAltitude} onChange={e=>setTakeoffAltitude(Number(e.target.value))}/></label><label>最大速度（m/s）<input type="number" min="1" max="20" value={maxSpeed} onChange={e=>setMaxSpeed(Number(e.target.value))}/></label></div><button className="blue-button" onClick={()=>openStep(5)}>下一步：场景选择 →</button></section>}
          {step === 6 && <section className="exp-panel inline-config"><div className="exp-title"><span>任务模板</span><small>选择基础航线，后续可在经典控制台自定义航点</small></div><div className="choice-row">{["正方形巡检","三角形测绘","往返航线","自定义航线"].map(item=><button key={item} onClick={()=>setModal(item)}><strong>{item}</strong><small>{item === "自定义航线" ? "进入地图编辑器绘制航线" : "自动生成安全高度航点"}</small></button>)}</div><button className="blue-button" onClick={()=>openStep(7)}>下一步：确认创建 →</button></section>}
          <div className="experiment-grid">
            <section className="exp-panel vehicle-panel"><div className="exp-title"><span>无人机平台选择</span><small>选择一台用于本次实验</small></div><div className="vehicle-cards">{vehicles.map(([name, spec, desc], index) => <button key={name} className={vehicle === name ? "selected" : ""} onClick={() => setVehicle(name)}><div className={`drone-visual drone-${index + 1}`}>✦</div><strong>{name}</strong><span>{spec}</span><small>{desc}</small>{vehicle === name && <b className="selected-mark">✓</b>}</button>)}</div><div className="vehicle-detail"><div className="drone-preview"><span>✦</span><small>450mm</small></div><div><b>当前选择</b><strong>{vehicle}</strong><p>最大起飞重量　0.6kg<br/>最大速度　8m/s<br/>续航时间　20min</p></div></div></section>
            <section className="exp-panel scene-panel"><div className="exp-title"><span>场景预览：{scene}</span><button onClick={() => setModal("场景选择")}>更换场景</button></div><div className="scene-preview"><div className="scene-horizon" /><div className="scene-grid-lines" /><div className="scene-building">校园<br/><small>SIMULATION</small></div><div className="scene-drone">✦</div></div><div className="environment-row"><span>⌂ 场景<br/><b>{scene}</b></span><span>⌁ 地形<br/><b>平原</b></span><span>☼ 天气<br/><b>多云</b></span><span>≋ 风速<br/><b>2.3 m/s</b></span><span>♨ 温度<br/><b>25°C</b></span></div><div className="coordinate-row"><label>纬度<strong>34.341600</strong></label><label>经度<strong>108.939800</strong></label><label>高度<strong>{telemetry.altitude.toFixed(1)} m</strong></label><button onClick={() => setModal("修改坐标")}>修改坐标</button></div></section>
            <section className="exp-panel summary-panel"><div className="exp-title"><span>确认创建</span></div><dl><dt>无人机</dt><dd>{vehicle}</dd><dt>飞控</dt><dd>{controller}</dd><dt>传感器</dt><dd>{sensors.join(" · ")}</dd><dt>场景</dt><dd>{scene}</dd><dt>起飞高度</dt><dd>{takeoffAltitude} m</dd><dt>最大速度</dt><dd>{maxSpeed} m/s</dd></dl><button className="create-button" disabled={launching} onClick={async () => { setLaunching(true); setLaunchMessage("正在连接飞控并执行起飞检查…"); try { await sendGatewayCommand("/api/commands/mode", { mode: "GUIDED" }); await sendGatewayCommand("/api/commands/arm", { arm: true }); await sendGatewayCommand("/api/commands/takeoff", { altitude: takeoffAltitude }); setLaunchMessage("起飞指令已下发，正在接收实时遥测"); } catch (error) { setLaunchMessage(error instanceof Error ? error.message : "启动实验失败"); } finally { setLaunching(false); } }}>{launching ? "正在启动…" : "创建实验并启动"}</button>{launchMessage && <p className="launch-message">{launchMessage}</p>}</section>
          </div>
          <section className="exp-panel status-panel"><div className="exp-title"><span>当前飞控状态</span><span className={gateway.connection.connected ? "online" : "offline"}>● {gateway.connection.connected ? "MAVLink 已连接" : "等待连接"}</span></div><div className="status-metrics"><b><small>模式</small>{gateway.vehicle.mode}</b><b><small>解锁</small>{armed ? "ARMED" : "SAFE"}</b><b><small>高度</small>{telemetry.altitude.toFixed(1)} m</b><b><small>速度</small>{telemetry.groundSpeed.toFixed(1)} m/s</b><b><small>GPS</small>{telemetry.satellites} 星</b><button className="blue-button" onClick={onOpenLegacy}>进入飞行控制台 →</button></div></section>
        </main>
      </div>
      {modal && <div className="experiment-modal-backdrop" onClick={() => setModal(null)}><div className="experiment-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setModal(null)}>×</button><small>实验一配置</small><h2>{modal}</h2><p>这是该步骤的配置面板。当前原型保留选择入口，后续可接入对应的飞控和仿真参数。</p><div className="modal-options">{(modal === "场景选择" ? ["校园环境", "城市街区", "野外丘陵"] : ["默认配置", "教学安全配置", "高级配置"]).map((item) => <button key={item} onClick={() => { if (modal === "场景选择") setScene(item); setModal(null); }}>{item}<span>›</span></button>)}</div><button className="blue-button modal-confirm" onClick={() => setModal(null)}>确认选择</button></div></div>}
    </div>
  );
}

function StatusItem({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
  return (
    <div className={`top-status ${accent ? "is-accent" : ""}`}>
      {icon}
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ArtificialHorizon({ roll, pitch, heading }: { roll: number; pitch: number; heading: number }) {
  return (
    <div className="horizon-wrap" aria-label="姿态仪">
      <div className="horizon-dial">
        <div className="horizon-world" style={{ transform: `translateY(${pitch * 1.2}px) rotate(${-roll}deg)` }}>
          <div className="sky" />
          <div className="ground" />
          <div className="horizon-line" />
        </div>
        <div className="pitch-mark pitch-mark-top">10</div>
        <div className="pitch-mark pitch-mark-bottom">10</div>
        <div className="aircraft-reference"><span /><i /><span /></div>
        <div className="bank-pointer" />
      </div>
      <div className="horizon-values">
        <span>横滚 <strong>{roll.toFixed(1)}°</strong></span>
        <span>俯仰 <strong>{pitch.toFixed(1)}°</strong></span>
        <span>航向 <strong>{Math.round(heading)}°</strong></span>
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Keep small telemetry jitter from rendering as alternating full-height bars.
  const range = Math.max(max - min, 5);
  const scaleMin = (min + max) / 2 - range / 2;
  return (
    <div className="sparkline" aria-hidden="true">
      {values.map((value, index) => (
        <span key={index} style={{ height: `${18 + Math.max(0, Math.min(1, (value - scaleMin) / range)) * 74}%` }} />
      ))}
    </div>
  );
}

function Metric({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: "good" | "warn" }) {
  return (
    <div className={`metric ${tone ? `tone-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}<small>{unit}</small></strong>
    </div>
  );
}

function TelemetryPanel({
  telemetry,
  connected,
  homeDistance,
  altitudeHistory,
}: {
  telemetry: Telemetry;
  connected: boolean;
  homeDistance: number;
  altitudeHistory: number[];
}) {
  const gpsLabel = telemetry.gpsFixType >= 6 ? "RTK Fixed" : telemetry.gpsFixType >= 3 ? "GPS 3D Fix" : "无 3D 定位";
  return (
    <aside className="telemetry-panel panel-section">
      <div className="section-title">
        <div><span className="eyebrow">FLIGHT DATA</span><h2>飞行遥测</h2></div>
        <span className={`live-indicator ${connected ? "" : "offline"}`}><i />{connected ? "实时" : "离线"}</span>
      </div>
      <ArtificialHorizon roll={telemetry.roll} pitch={telemetry.pitch} heading={telemetry.heading} />
      <div className="metrics-grid">
        <Metric label="相对高度" value={telemetry.altitude.toFixed(1)} unit="m" />
        <Metric label="地速" value={telemetry.groundSpeed.toFixed(1)} unit="m/s" />
        <Metric label="爬升率" value={telemetry.climbRate.toFixed(1)} unit="m/s" tone="good" />
        <Metric label="距 Home" value={connected ? Math.round(homeDistance).toString() : "--"} unit="m" />
      </div>
      <div className="telemetry-group">
        <div className="group-heading"><span>动力系统</span><strong>{telemetry.battery >= 0 ? `${telemetry.battery}%` : "--"}</strong></div>
        <div className="battery-track"><span style={{ width: `${Math.max(0, telemetry.battery)}%` }} /></div>
        <div className="compact-stats">
          <span><Zap size={14} /> {telemetry.voltage.toFixed(1)} V</span>
          <span><Activity size={14} /> {telemetry.current.toFixed(1)} A</span>
          <span>消耗 1.42 Ah</span>
        </div>
      </div>
      <div className="telemetry-group signal-health">
        <div className="group-heading"><span>定位与链路</span><span className="health-label">健康</span></div>
        <div className="signal-row"><span><Satellite size={15} /> {gpsLabel}</span><strong>{telemetry.satellites} 星</strong></div>
        <div className="signal-row"><span><Crosshair size={15} /> HDOP</span><strong>{telemetry.hdop.toFixed(2)}</strong></div>
        <div className="signal-row"><span><Signal size={15} /> MAVLink</span><strong>{telemetry.linkQuality >= 0 ? `${telemetry.linkQuality}%` : connected ? "在线" : "离线"}</strong></div>
      </div>
      <div className="trend-block">
        <div className="group-heading"><span>高度趋势</span><small>最近 60 秒</small></div>
        <Sparkline values={altitudeHistory} />
      </div>
    </aside>
  );
}

function lineGeoJson(coordinates: [number, number][]): GeoJSON.GeoJSON {
  if (coordinates.length < 2) return { type: "FeatureCollection", features: [] };
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates },
  };
}

function orderedRouteCoordinates(mission: MissionPoint[]): [number, number][] {
  // The mission array is the execution order. Never sort by map position or id.
  return mission
    .filter((point) => Number.isFinite(point.coordinates[0]) && Number.isFinite(point.coordinates[1]))
    .map((point) => [point.coordinates[0], point.coordinates[1]] as [number, number]);
}

function FlightMap({
  mission,
  heading,
  coordinates,
  home,
  track,
  routeDistance,
  planningView,
  planningMode,
  selectedMissionId,
  missionBusy,
  onTogglePlanning,
  onMapPick,
  onMarkerSelect,
  onMarkerMove,
  onCreateSurvey,
  onPickHome,
}: {
  mission: MissionPoint[];
  heading: number;
  coordinates: [number, number];
  home: [number, number];
  track: TrackPoint[];
  routeDistance: number;
  planningView: boolean;
  planningMode: boolean;
  selectedMissionId: number | null;
  missionBusy: boolean;
  onTogglePlanning: () => void;
  onMapPick: (coordinates: [number, number]) => void;
  onMarkerSelect: (id: number) => void;
  onMarkerMove: (id: number, coordinates: [number, number]) => void;
  onCreateSurvey: () => void;
  onPickHome: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const homeMarkerRef = useRef<Marker | null>(null);
  const missionMarkersRef = useRef<Map<number, Marker>>(new Map());
  const planningModeRef = useRef(planningMode);
  const mapPickRef = useRef(onMapPick);
  const markerSelectRef = useRef(onMarkerSelect);
  const [mapReady, setMapReady] = useState(false);
  const vehiclePosition: [number, number] = coordinates[0] && coordinates[1] ? coordinates : [108.9412, 34.3422];
  const routeGeoJson = useMemo(() => lineGeoJson(orderedRouteCoordinates(mission)), [mission]);
  const trackCoordinates = useMemo<[number, number][]>(() => track
    .filter((point) => Number.isFinite(point.longitude) && Number.isFinite(point.latitude))
    .map((point) => [point.longitude, point.latitude]), [track]);
  const trackGeoJson = useMemo(() => lineGeoJson(trackCoordinates), [trackCoordinates]);
  const recentTrackGeoJson = useMemo(() => lineGeoJson(trackCoordinates.slice(-30)), [trackCoordinates]);

  planningModeRef.current = planningMode;
  mapPickRef.current = onMapPick;
  markerSelectRef.current = onMarkerSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: home,
      zoom: 15.5,
      bearing: -18,
      pitch: 35,
      attributionControl: false,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#dfe5e3" } },
          { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.65, "raster-contrast": 0.06, "raster-brightness-min": 0.12, "raster-brightness-max": 0.92 } },
        ],
      },
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-left");
    map.on("load", () => {
      map.addSource("mission-route", { type: "geojson", data: routeGeoJson });
      map.addLayer({
        id: "mission-route-shadow",
        type: "line",
        source: "mission-route",
        paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.72 },
      });
      map.addLayer({
        id: "mission-route-line",
        type: "line",
        source: "mission-route",
        paint: { "line-color": "#176bc0", "line-width": 3, "line-dasharray": [1.5, 1.2], "line-opacity": 0.96 },
      });
      map.addSource("flight-track", { type: "geojson", data: trackGeoJson, lineMetrics: true });
      map.addLayer({
        id: "flight-track-line",
        type: "line",
        source: "flight-track",
        paint: {
          "line-width": 3,
          "line-opacity": 0.72,
          "line-color": ["interpolate", ["linear"], ["line-progress"], 0, "#b8d5e5", 0.55, "#4ca4d3", 1, "#125b9b"],
        },
      });
      map.addSource("flight-track-recent", { type: "geojson", data: recentTrackGeoJson });
      map.addLayer({
        id: "flight-track-recent-line",
        type: "line",
        source: "flight-track-recent",
        paint: { "line-color": "#0b6db7", "line-width": 5, "line-opacity": 0.9 },
      });
      setMapReady(true);
    });
    map.on("click", (event) => {
      if (planningModeRef.current) mapPickRef.current([event.lngLat.lng, event.lngLat.lat]);
    });
    mapRef.current = map;
    const markerElement = document.createElement("div");
    markerElement.className = "vehicle-marker";
    markerElement.innerHTML = "<span>▲</span>";
    const marker = new maplibregl.Marker({ element: markerElement, rotationAlignment: "map" })
      .setLngLat(vehiclePosition)
      .addTo(map);
    markerRef.current = marker;
    return () => {
      missionMarkersRef.current.forEach((item) => item.remove());
      missionMarkersRef.current.clear();
      homeMarkerRef.current?.remove();
      marker.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const routeSource = mapRef.current?.getSource("mission-route") as GeoJSONSource | undefined;
    routeSource?.setData(routeGeoJson);
    const trackSource = mapRef.current?.getSource("flight-track") as GeoJSONSource | undefined;
    trackSource?.setData(trackGeoJson);
    const recentSource = mapRef.current?.getSource("flight-track-recent") as GeoJSONSource | undefined;
    recentSource?.setData(recentTrackGeoJson);
  }, [routeGeoJson, trackGeoJson, recentTrackGeoJson, mapReady]);

  useEffect(() => {
    const element = markerRef.current?.getElement().querySelector("span") as HTMLElement | null;
    if (element) element.style.transform = `rotate(${heading}deg)`;
  }, [heading]);

  useEffect(() => {
    markerRef.current?.setLngLat(vehiclePosition);
  }, [vehiclePosition[0], vehiclePosition[1]]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    missionMarkersRef.current.forEach((item) => item.remove());
    missionMarkersRef.current.clear();
    mission.forEach((point, index) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = `mission-map-marker mission-map-marker-${point.command.toLowerCase()} ${selectedMissionId === point.id ? "is-selected" : ""}`;
      element.title = `${index + 1}. ${point.label}`;
      element.setAttribute("aria-label", `编辑 ${point.label}`);
      element.innerHTML = `<span>${point.command === "TAKEOFF" ? "T" : point.command === "RTL" ? "R" : point.command === "LAND" ? "L" : index}</span>`;
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        markerSelectRef.current(point.id);
      });
      const marker = new maplibregl.Marker({
        element,
        anchor: "bottom",
        draggable: planningView && selectedMissionId === point.id && !missionBusy && point.command !== "RTL",
      }).setLngLat(point.coordinates).addTo(map);
      marker.on("dragend", () => {
        const position = marker.getLngLat();
        onMarkerMove(point.id, [position.lng, position.lat]);
      });
      missionMarkersRef.current.set(point.id, marker);
    });
    const homeElement = document.createElement("div");
    homeElement.className = "home-map-marker";
    homeElement.innerHTML = "<span>H</span>";
    homeElement.title = "Home 点";
    homeMarkerRef.current?.remove();
    homeMarkerRef.current = new maplibregl.Marker({ element: homeElement, anchor: "bottom" }).setLngLat(home).addTo(map);
  }, [mission, home, missionBusy, planningView, selectedMissionId]);

  const recenter = () => mapRef.current?.flyTo({ center: vehiclePosition, zoom: 16.5, pitch: 40, duration: 900 });
  const routeLabel = routeDistance >= 1000 ? `${(routeDistance / 1000).toFixed(2)} km` : `${Math.round(routeDistance)} m`;

  return (
    <section className={`map-stage ${planningMode ? "is-planning" : ""} ${planningView ? "is-plan-view" : ""}`}>
      <div className="map-canvas" ref={containerRef} />
      {planningView && <div className="plan-toolbox" aria-label="规划工具">
        <IconButton label="选择航点" active={!planningMode} onClick={() => planningMode && onTogglePlanning()}><MousePointer2 size={18} /></IconButton>
        <IconButton label={missionBusy ? "任务执行中不可编辑" : planningMode ? "停止连续添加" : "连续添加航点"} active={planningMode} onClick={onTogglePlanning} disabled={missionBusy}><MapPinPlus size={18} /></IconButton>
        <IconButton label="生成区域测绘航线" onClick={onCreateSurvey} disabled={missionBusy}><Layers3 size={18} /></IconButton>
        <span className="toolbox-divider" />
        <IconButton label="设置规划起始点" onClick={onPickHome} disabled={missionBusy}><Home size={18} /></IconButton>
      </div>}
      <div className="map-toolbar">
        <IconButton label="定位无人机" onClick={recenter}><LocateFixed size={18} /></IconButton>
        {!planningView && <IconButton label="进入规划视图添加航点" disabled><MapPinPlus size={18} /></IconButton>}
        <IconButton label="地图图层"><Layers3 size={18} /></IconButton>
        <span className="toolbar-divider" />
        <IconButton label="放大" onClick={() => mapRef.current?.zoomIn()}><Plus size={18} /></IconButton>
        <IconButton label="缩小" onClick={() => mapRef.current?.zoomOut()}><span className="minus-icon">−</span></IconButton>
      </div>
      <div className="map-context">
        <span className="map-chip"><Navigation size={14} /> 航向 {Math.round(heading)}°</span>
        <span className="map-chip"><Route size={14} /> 航线 {routeLabel}</span>
        {planningView && <span className="map-chip"><Waypoints size={14} /> 按任务顺序连接</span>}
        {planningMode && <span className="map-chip map-chip-planning"><MapPinPlus size={14} /> 选点中</span>}
      </div>
      <div className="map-legend" aria-label="地图图例">
        <span><i className="legend-home" /> Home</span>
        <span><i className="legend-waypoint" /> 航点</span>
        <span><i className="legend-track" /> 飞行轨迹</span>
      </div>
    </section>
  );
}

function MissionList({ mission, selectedId, disabled, onEdit, onRemove, onReorder }: { mission: MissionPoint[]; selectedId: number | null; disabled: boolean; onEdit: (point: MissionPoint) => void; onRemove: (id: number) => void; onReorder: (sourceId: number, targetId: number) => void }) {
  const [draggingId, setDraggingId] = useState<number | null>(null);
  return (
    <div className="mission-list" aria-label="任务指令列表">
      {mission.map((point, index) => (
        <div
          className={`mission-row ${selectedId === point.id ? "is-selected" : ""} ${draggingId === point.id ? "is-dragging" : ""}`}
          key={point.id}
          draggable={!disabled && point.command !== "TAKEOFF" && !isTerminalCommand(point.command)}
          onDragStart={(event) => { setDraggingId(point.id); event.dataTransfer.setData("text/plain", String(point.id)); event.dataTransfer.effectAllowed = "move"; }}
          onDragEnd={() => setDraggingId(null)}
          onDragOver={(event) => { if (!disabled && point.command !== "TAKEOFF" && !isTerminalCommand(point.command)) event.preventDefault(); }}
          onDrop={(event) => { event.preventDefault(); const sourceId = Number(event.dataTransfer.getData("text/plain")); if (sourceId && sourceId !== point.id) onReorder(sourceId, point.id); setDraggingId(null); }}
        >
          <span className="mission-drag-handle" title="拖动调整顺序" aria-hidden="true"><Menu size={13} /></span>
          <span className={`sequence sequence-${point.command.toLowerCase()}`}>{point.command === "TAKEOFF" ? "T" : point.command === "RTL" ? <Home size={13} /> : point.command === "LAND" ? "L" : index}</span>
          <button className="mission-row-main" type="button" onClick={() => onEdit(point)} aria-label={`编辑 ${point.label}`}>
            <strong>{point.label}</strong>
            <small>{missionCommandLabel(point.command)} · {point.altitude || 0} m{point.command === "LOITER_TIME" ? ` · ${point.param1}s` : ""}</small>
          </button>
          <button className="mission-row-action" title="编辑任务项" aria-label={`编辑 ${point.label}`} onClick={() => onEdit(point)}><Pencil size={14} /></button>
          {(point.command === "WAYPOINT" || point.command === "LOITER_TIME") && <button className="mission-row-action" title="删除航点" aria-label={`删除 ${point.label}`} onClick={() => onRemove(point.id)}><Trash2 size={15} /></button>}
        </div>
      ))}
    </div>
  );
}

function MissionEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  onPickOnMap,
  onDelete,
}: {
  draft: MissionDraft;
  onChange: (draft: MissionDraft) => void;
  onSave: () => void;
  onCancel: () => void;
  onPickOnMap: () => void;
  onDelete: () => void;
}) {
  const selectedCommand = missionCommands.find((item) => item.value === draft.command);
  const coordinateLocked = draft.command === "RTL";
  const altitudeMin = draft.command === "LAND" || draft.command === "RTL" ? 0 : 2;
  return (
    <form className="mission-editor" aria-label="航点属性" noValidate onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <div className="mission-editor-heading">
        <div><span className="eyebrow">MISSION ITEM</span><strong>{draft.id ? "编辑任务项" : "新建任务项"}</strong></div>
        <button type="button" className="icon-button light" title="关闭编辑器" aria-label="关闭编辑器" onClick={onCancel}><X size={16} /></button>
      </div>
      <label className="editor-field"><span>任务类型</span><div className="select-wrap compact-select"><CrosshairIcon size={15} /><select aria-label="任务类型" value={draft.command} onChange={(event) => onChange({ ...draft, command: event.target.value as MissionCommand, label: event.target.value === "WAYPOINT" ? draft.label : missionCommandLabel(event.target.value as MissionCommand) })}>{missionCommands.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><ChevronDown size={14} /></div><small>{selectedCommand?.description}</small></label>
      <label className="editor-field"><span>名称</span><input aria-label="任务项名称" value={draft.label} maxLength={32} onChange={(event) => onChange({ ...draft, label: event.target.value })} /></label>
      <div className="editor-grid two-columns">
        <label className="editor-field"><span>纬度</span><input aria-label="纬度" type="number" step="any" min="-90" max="90" value={draft.coordinates[1]} disabled={coordinateLocked} onChange={(event) => onChange({ ...draft, coordinates: [draft.coordinates[0], Number(event.target.value)] })} /></label>
        <label className="editor-field"><span>经度</span><input aria-label="经度" type="number" step="any" min="-180" max="180" value={draft.coordinates[0]} disabled={coordinateLocked} onChange={(event) => onChange({ ...draft, coordinates: [Number(event.target.value), draft.coordinates[1]] })} /></label>
      </div>
      <button type="button" className="secondary-command editor-map-pick" onClick={onPickOnMap} disabled={coordinateLocked}><MapPinPlus size={15} /> {coordinateLocked ? "返航使用飞控 Home" : "从地图重新选点"}</button>
      <div className="editor-grid two-columns">
        <label className="editor-field"><span>相对高度</span><div className="input-with-unit"><input aria-label="任务高度" type="number" min={altitudeMin} max="120" step="0.5" value={draft.altitude} onChange={(event) => onChange({ ...draft, altitude: Number(event.target.value) })} /><small>m</small></div></label>
        {draft.command === "LOITER_TIME" ? <label className="editor-field"><span>悬停时间</span><div className="input-with-unit"><input aria-label="悬停时间" type="number" min="0" max="3600" step="1" value={draft.param1} onChange={(event) => onChange({ ...draft, param1: Number(event.target.value) })} /><small>s</small></div></label> : <label className="editor-field"><span>到达半径</span><div className="input-with-unit"><input aria-label="到达半径" type="number" min="0" max="1000" step="0.5" value={draft.param2} onChange={(event) => onChange({ ...draft, param2: Number(event.target.value) })} /><small>m</small></div></label>}
      </div>
      <div className="editor-grid two-columns">
        <label className="editor-field"><span>航向角</span><div className="input-with-unit"><input aria-label="航向角" type="number" min="-360" max="360" step="1" value={draft.param4} onChange={(event) => onChange({ ...draft, param4: Number(event.target.value) })} /><small>°</small></div></label>
        <div className="editor-coordinate-readout"><span>坐标</span><strong>{draft.coordinates[1].toFixed(6)}, {draft.coordinates[0].toFixed(6)}</strong></div>
      </div>
      <div className="mission-editor-actions">
        <button type="button" className="danger-command editor-delete" onClick={onDelete} disabled={draft.command === "TAKEOFF" || isTerminalCommand(draft.command)}><Trash2 size={14} /> 删除</button>
        <button type="button" className="secondary-command" onClick={onCancel}>取消</button>
        <button type="submit" className="primary-command"><Check size={15} /> 保存</button>
      </div>
    </form>
  );
}

type MonitorFilter = "key" | "all" | "alerts" | "mission";

function MavlinkConsole({ monitor, docked = false, onShowEvents, eventLabel }: { monitor: MonitorSnapshot; docked?: boolean; onShowEvents?: () => void; eventLabel?: string }) {
  const [filter, setFilter] = useState<MonitorFilter>("key");
  const [pausedAt, setPausedAt] = useState<number | null>(null);
  const [clearedThrough, setClearedThrough] = useState(0);
  const outputRef = useRef<HTMLDivElement>(null);
  const latestEntryId = monitor.entries.at(-1)?.id ?? 0;
  const visibleEntries = monitor.entries.filter((entry) => {
    if (entry.id <= clearedThrough || (pausedAt !== null && entry.id > pausedAt)) return false;
    if (filter === "key") return entry.category !== "heartbeat";
    if (filter === "alerts") return entry.severity === "error" || entry.severity === "warning";
    if (filter === "mission") return entry.category === "mission" || entry.category === "command";
    return true;
  });

  useEffect(() => {
    if (pausedAt === null && outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [monitor.version, filter, pausedAt]);

  const clearConsole = () => {
    setClearedThrough(latestEntryId);
    if (pausedAt !== null) setPausedAt(latestEntryId);
  };

  return (
    <section className={`mavlink-console ${docked ? "is-docked" : ""}`} aria-label="飞控回传控制台">
      <div className="mavlink-console-heading">
        <div className="mavlink-console-title"><Terminal size={15} /><div><strong>飞控回传</strong><span>只读 · UDP 14553</span></div></div>
        <div className="mavlink-console-actions">
          {onShowEvents && <button className="monitor-view-switch" type="button" onClick={onShowEvents}><ListChecks size={12} />{eventLabel}</button>}
          <span className={`monitor-link-state ${monitor.connection.connected ? "is-online" : ""}`}><i />{monitor.connection.connected ? "实时" : monitor.connection.transportConnected ? "等待心跳" : "未连接"}</span>
          <button type="button" title={pausedAt === null ? "暂停滚动" : "继续滚动"} aria-label={pausedAt === null ? "暂停飞控回传" : "继续飞控回传"} onClick={() => setPausedAt((current) => current === null ? latestEntryId : null)}>{pausedAt === null ? <Pause size={13} /> : <Play size={13} />}</button>
          <button type="button" title="清空当前显示" aria-label="清空飞控回传" onClick={clearConsole}><Eraser size={13} /></button>
        </div>
      </div>
      <div className="mavlink-console-toolbar">
        <div className="monitor-filters" aria-label="回传过滤">
          {([['key', '关键'], ['all', '全部'], ['alerts', '告警'], ['mission', '任务']] as const).map(([value, label]) => <button type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)} key={value}>{label}</button>)}
        </div>
        <span>{monitor.entries.length} 条关键 · {monitor.packetCount.toLocaleString()} 包</span>
      </div>
      <div className="mavlink-console-output" ref={outputRef} role="log" aria-live="off">
        {visibleEntries.length === 0
          ? <div className="monitor-empty">{monitor.connection.transportConnected ? "等待飞控回传消息..." : "监听 14553，等待独立 MAVLink 输出..."}</div>
          : visibleEntries.map((entry) => (
            <div className={`monitor-line monitor-line-${entry.severity}`} key={entry.id}>
              <time>{new Date(entry.timestamp * 1000).toLocaleTimeString("zh-CN", { hour12: false })}</time>
              <strong>{entry.type}</strong>
              <span>{entry.text}</span>
            </div>
          ))}
      </div>
      <div className="mavlink-console-footer"><span>SYS {monitor.entries.at(-1)?.sourceSystem ?? "--"}</span><span>COMP {monitor.entries.at(-1)?.sourceComponent ?? "--"}</span><span>{monitor.connection.lastHeartbeatAgeMs === null ? "HB --" : `HB ${monitor.connection.lastHeartbeatAgeMs} ms`}</span></div>
    </section>
  );
}

function ControlPanel({
  activeView,
  connected,
  armed,
  mode,
  endpoint,
  heartbeatAgeMs,
  activeMission,
  missionSync,
  missionBusy,
  commandState,
  mission,
  selectedMissionId,
  missionDraft,
  routeDistance,
  estimatedSeconds,
  planHome,
  actualHome,
  defaultAltitude,
  cruiseSpeed,
  onModeChange,
  onArm,
  onCommand,
  onRemoveMission,
  onAddMission,
  onEditMission,
  onDraftChange,
  onSaveDraft,
  onCancelDraft,
  onPickEditorMap,
  onMissionRead,
  onMissionUpload,
  onMissionStart,
  onReorderMission,
  onDefaultAltitudeChange,
  onCruiseSpeedChange,
}: {
  activeView: View;
  connected: boolean;
  armed: boolean;
  mode: string;
  endpoint: string;
  heartbeatAgeMs: number | null;
  activeMission: { state: "idle" | "loaded" | "starting" | "active" | "completed" | "failed" | "aborted"; current: number; total: number; distanceToWaypoint: number; verified: boolean; verifiedAt: number | null; missionHash: string | null };
  missionSync: MissionSyncState;
  missionBusy: boolean;
  commandState: CommandState;
  mission: MissionPoint[];
  selectedMissionId: number | null;
  missionDraft: MissionDraft | null;
  routeDistance: number;
  estimatedSeconds: number;
  planHome: [number, number];
  actualHome: HomePosition;
  defaultAltitude: number;
  cruiseSpeed: number;
  onModeChange: (mode: string) => void;
  onArm: () => void;
  onCommand: (action: FlightAction, value?: number) => void;
  onRemoveMission: (id: number) => void;
  onAddMission: () => void;
  onEditMission: (point: MissionPoint) => void;
  onDraftChange: (draft: MissionDraft) => void;
  onSaveDraft: () => void;
  onCancelDraft: () => void;
  onPickEditorMap: () => void;
  onMissionRead: () => void;
  onMissionUpload: () => void;
  onMissionStart: () => void;
  onReorderMission: (sourceId: number, targetId: number) => void;
  onDefaultAltitudeChange: (value: number) => void;
  onCruiseSpeedChange: (value: number) => void;
}) {
  const [takeoffAltitude, setTakeoffAltitude] = useState(20);

  if (activeView === "mission") {
    const uploadDisabled = !connected || armed || missionBusy || commandState === "pending";
    const executeDisabled = !connected || !armed || missionSync !== "verified" || missionBusy || commandState === "pending";
    const primaryDisabled = !connected || missionBusy || commandState === "pending";
    const uploadBlockReason = !connected
      ? "飞控未连接"
      : armed
        ? "上传前需要锁定飞行器"
        : missionBusy
          ? "任务执行中"
          : commandState === "pending"
            ? "等待飞控确认"
            : "";
    const executeState = missionBusy
      ? "任务正在执行"
      : commandState === "pending"
        ? "等待飞控确认"
        : !connected
          ? "飞控未连接"
          : missionSync !== "verified"
            ? "执行前需要上传并校验航线"
            : !armed
              ? "航线已就绪，等待飞行器解锁"
              : "执行条件已满足";
    return (
      <aside className="control-panel panel-section">
        <div className="section-title">
          <div><span className="eyebrow">PLAN VIEW</span><h2>任务规划</h2></div>
          <IconButton label="任务设置"><SlidersHorizontal size={18} /></IconButton>
        </div>
        <div className="mission-summary">
          <div><strong>{mission.length}</strong><span>任务项</span></div>
          <div><strong>{routeDistance >= 1000 ? (routeDistance / 1000).toFixed(1) : Math.round(routeDistance)}</strong><span>{routeDistance >= 1000 ? "公里" : "米"}</span></div>
          <div><strong>{`${String(Math.floor(estimatedSeconds / 60)).padStart(2, "0")}:${String(Math.round(estimatedSeconds % 60)).padStart(2, "0")}`}</strong><span>预计时间</span></div>
        </div>
        <div className="plan-home-card">
          <span className="plan-home-icon"><Home size={15} /></span>
          <div><strong>规划起始点</strong><small>{planHome[1].toFixed(6)}, {planHome[0].toFixed(6)}</small></div>
          <span className="plan-home-source">{actualHome.valid ? "源自飞控 Home" : "本地估算"}</span>
        </div>
        <div className={`mission-sync mission-sync-${missionSync}`} role="status">
          <i />{missionSync === "verified" ? "航线已上传并校验" : missionSync === "dirty" ? "本地修改未上传" : "尚未从飞控校验"}
        </div>
        <MissionList mission={mission} selectedId={selectedMissionId} disabled={missionBusy} onEdit={(point) => { if (!missionBusy) onEditMission(point); }} onRemove={(id) => { if (!missionBusy) onRemoveMission(id); }} onReorder={onReorderMission} />
        {!missionDraft && <button className="secondary-command full-width" disabled={missionBusy} onClick={onAddMission}><MapPinPlus size={16} /> 新建任务项</button>}
        {missionDraft && <MissionEditor draft={missionDraft} onChange={onDraftChange} onSave={onSaveDraft} onCancel={onCancelDraft} onPickOnMap={onPickEditorMap} onDelete={() => { onRemoveMission(missionDraft.id); onCancelDraft(); }} />}
        <div className="mission-options">
          <label><span>默认高度</span><div className="number-field"><input aria-label="默认高度" type="number" min="2" max="120" value={defaultAltitude} onChange={(event) => onDefaultAltitudeChange(Number(event.target.value))} /><small>m</small></div></label>
          <label><span>巡航速度</span><div className="number-field"><input aria-label="巡航速度" type="number" min="1" max="30" step="0.5" value={cruiseSpeed} onChange={(event) => onCruiseSpeedChange(Number(event.target.value))} /><small>m/s</small></div></label>
        </div>
        <div className="mission-readiness" aria-label="任务执行条件">
          <div className={connected ? "is-ready" : ""}><i /><span>链路</span><strong>{connected ? "在线" : "离线"}</strong></div>
          <div className={missionSync === "verified" ? "is-ready" : ""}><i /><span>航线</span><strong>{missionSync === "verified" ? "已校验" : missionSync === "dirty" ? "待上传" : "未校验"}</strong></div>
          <div className={armed ? "is-ready" : ""}><i /><span>飞行器</span><strong>{armed ? "已解锁" : "已锁定"}</strong></div>
        </div>
        <div className="control-footer">
          <button className="secondary-command" disabled={!connected || missionBusy || commandState === "pending"} onClick={onMissionRead}><RotateCcw size={16} /> 从飞控读取</button>
          <button className="primary-command" title={uploadBlockReason} disabled={uploadDisabled} onClick={onMissionUpload}><Waypoints size={17} /> 上传并校验</button>
        </div>
        {missionSync === "verified" && (!armed ? (
          <button className="primary-command full-width mission-primary-action" title={executeState} disabled={primaryDisabled} onClick={onArm}><UnlockKeyhole size={16} /> 解锁飞行器</button>
        ) : (
          <button className="primary-command full-width mission-primary-action" title={executeState} disabled={executeDisabled} onClick={onMissionStart}><PlaneTakeoff size={17} /> 执行任务</button>
        ))}
        <div className={`mission-action-state ${executeDisabled ? "is-blocked" : "is-ready"}`} role="status"><i />{executeState}</div>
      </aside>
    );
  }

  if (activeView === "system") {
    return (
      <aside className="control-panel panel-section">
        <div className="section-title"><div><span className="eyebrow">SYSTEM HEALTH</span><h2>系统状态</h2></div></div>
        <div className="health-checks">
          {[
            ["IMU", "正常", true], ["罗盘", "正常", true], ["GPS", "3D Fix", true], ["气压计", "正常", true],
            ["EKF", "方差正常", true], ["避障", "未配置", false], ["地形数据", "可用", true], ["围栏", "已启用", true],
          ].map(([name, value, ok]) => (
            <div className="health-row" key={String(name)}><span><i className={ok ? "ok" : "muted"} />{name}</span><strong>{value}</strong></div>
          ))}
        </div>
        <div className="system-note"><ShieldAlert size={18} /><div><strong>起飞检查通过</strong><span>未发现阻止解锁的问题</span></div></div>
        <button className="secondary-command full-width"><Settings2 size={16} /> 查看完整参数</button>
      </aside>
    );
  }

  return (
    <aside className="control-panel panel-section">
      <div className="section-title">
        <div><span className="eyebrow">VEHICLE CONTROL</span><h2>飞行控制</h2></div>
        <span className={`arm-badge ${armed ? "armed" : ""}`}>{armed ? "已解锁" : "已锁定"}</span>
      </div>
      <label className="field-label" htmlFor="flight-mode">飞行模式</label>
      <div className="select-wrap">
        <CircleGauge size={17} />
        <select id="flight-mode" value={mode} disabled={!connected || commandState === "pending"} onChange={(event) => onModeChange(event.target.value)}>
          {(modes.includes(mode) ? modes : [mode, ...modes]).map((item) => <option key={item}>{item}</option>)}
        </select>
        <ChevronDown size={16} />
      </div>
      <div className="command-block">
        <div className="command-block-title"><span>基础操作</span><small>{connected ? `心跳 ${heartbeatAgeMs ?? 0} ms` : "飞控离线"}</small></div>
        <button className={`arm-command ${armed ? "is-armed" : ""}`} onClick={onArm} disabled={!connected || commandState === "pending"}>
          {armed ? <LockKeyhole size={19} /> : <UnlockKeyhole size={19} />}
          <span>{armed ? "锁定飞行器" : "解锁飞行器"}<small>{armed ? "降落后方可锁定" : "所有起飞检查已通过"}</small></span>
          <i />
        </button>
        <div className="takeoff-control">
          <div><span>目标起飞高度</span><div className="number-field"><input aria-label="起飞高度" type="number" min="2" max="120" value={takeoffAltitude} onChange={(event) => setTakeoffAltitude(Number(event.target.value))} /><small>m</small></div></div>
          <button className="primary-command" disabled={!connected || !armed || commandState === "pending"} onClick={() => onCommand("takeoff", takeoffAltitude)}><PlaneTakeoff size={17} /> 起飞</button>
        </div>
      </div>
      <div className="command-block">
        <div className="command-block-title"><span>飞行处置</span></div>
        <div className="action-grid">
          <button className="secondary-command" disabled={!connected || commandState === "pending"} onClick={() => onCommand("hold")}><Crosshair size={17} /> 悬停</button>
          <button className="secondary-command" disabled={!connected || commandState === "pending"} onClick={() => onCommand("rtl")}><Home size={17} /> 返航</button>
          <button className="secondary-command" disabled={!connected || commandState === "pending"} onClick={() => onCommand("land")}><PlaneLanding size={17} /> 降落</button>
          <button className="danger-command" disabled={!connected || commandState === "pending"} onClick={() => onCommand("brake")}><AlertTriangle size={17} /> 刹停</button>
        </div>
      </div>
      <div className="command-block mission-progress-block">
        <div className="command-block-title"><span>当前任务 · {activeMission.state === "active" ? "执行中" : activeMission.state === "starting" ? "启动中" : activeMission.state === "completed" ? "已完成" : activeMission.state === "failed" ? "失败" : activeMission.state === "aborted" ? "已中止" : activeMission.state === "loaded" ? "已加载" : "空闲"}</span><strong>{activeMission.total > 0 ? `${activeMission.current} / ${activeMission.total}` : "--"}</strong></div>
        <div className="mission-progress"><span style={{ width: activeMission.total > 0 ? `${Math.min(100, activeMission.current / activeMission.total * 100)}%` : "0%" }} /></div>
        <div className="next-waypoint"><MapPin size={16} /><div><span>{activeMission.total > 0 ? "当前任务项" : "任务状态"}</span><strong>{activeMission.total > 0 ? `航点 ${activeMission.current} · ${activeMission.distanceToWaypoint} m` : "飞控未报告活动任务"}</strong></div></div>
      </div>
      <div className="link-detail"><Radio size={16} /><div><span>通信链路</span><strong>{endpoint}</strong></div><span className="latency">{connected ? `${heartbeatAgeMs ?? 0} ms` : "离线"}</span></div>
    </aside>
  );
}

function ActivityPanel({ activeView, messages, demoMode, monitor }: { activeView: View; messages: StatusMessage[]; demoMode: boolean; monitor: MonitorSnapshot }) {
  const [showMonitor, setShowMonitor] = useState(true);
  useEffect(() => setShowMonitor(true), [activeView]);
  const fallbackEvents = activeView === "mission"
    ? [
      ["19:43:28", "航线草稿已更新", "航点 2 高度设置为 30 m"],
      ["19:41:06", "飞控航线读取完成", "共读取 4 个任务项"],
      ["19:40:52", "任务校验通过", "航线位于围栏范围内"],
    ]
    : [
      ["19:43:28", "Reached command #1", "飞控已到达航点 1"],
      ["19:42:16", "Mode AUTO", "飞行模式已切换"],
      ["19:41:52", "EKF3 IMU0 is using GPS", "定位状态正常"],
    ];
  const events = activeView !== "mission" && messages.length
    ? messages.slice(0, 3).map((message) => [
      new Date(message.timestamp * 1000).toLocaleTimeString("zh-CN", { hour12: false }),
      message.text,
      `MAVLink severity ${message.severity}`,
    ])
    : activeView === "mission" || demoMode
      ? fallbackEvents
      : [["--:--:--", "暂无飞控消息", "等待飞控 STATUSTEXT"]];

  if (showMonitor) {
    return (
      <section className="activity-panel panel-section console-activity">
        <MavlinkConsole monitor={monitor} docked onShowEvents={() => setShowMonitor(false)} eventLabel={activeView === "mission" ? "任务记录" : "消息摘要"} />
      </section>
    );
  }

  return (
    <section className="activity-panel panel-section">
      <div className="activity-heading"><div><ListChecks size={16} /><strong>{activeView === "mission" ? "任务记录" : "飞控消息"}</strong><span>3</span></div><button onClick={() => setShowMonitor(true)}>飞控回传</button></div>
      <div className="event-list">
        {events.map(([time, title, detail], index) => (
          <div className="event-row" key={time}><time>{time}</time><i className={index === 0 ? "active" : ""} /><strong>{title}</strong><span>{detail}</span></div>
        ))}
      </div>
    </section>
  );
}

function ConfirmDialog({ armed, onClose, onConfirm }: { armed: boolean; onClose: () => void; onConfirm: () => void }) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="dialog-close" title="关闭" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        <div className={`dialog-icon ${armed ? "warn" : ""}`}>{armed ? <LockKeyhole size={24} /> : <UnlockKeyhole size={24} />}</div>
        <h3 id="confirm-title">确认{armed ? "锁定" : "解锁"}飞行器</h3>
        <p>{armed ? "请确认飞行器已经安全降落。飞行中锁定可能导致动力立即停止。" : "桨叶可能立即旋转。请确认飞行区域安全，人员已远离飞行器。"}</p>
        <div className="dialog-checks"><span><i /> GPS 与 EKF 正常</span><span><i /> 电池电压正常</span><span><i /> 飞控心跳正常</span></div>
        <div className="dialog-actions"><button className="secondary-command" onClick={onClose}>取消</button><button className={armed ? "danger-command" : "primary-command"} onClick={onConfirm}>{armed ? "确认锁定" : "确认解锁"}</button></div>
      </div>
    </div>
  );
}

export default function App() {
  const demoMode = new URLSearchParams(window.location.search).get("demo") === "1";
  const gateway = useVehicleGateway(demoMode);
  const monitor = useMavlinkMonitor(demoMode);
  const telemetry = gateway.telemetry;
  const [showExperiments, setShowExperiments] = useState(true);
  const [activeView, setActiveView] = useState<View>("flight");
  const [mode, setMode] = useState(gateway.vehicle.mode);
  const [armed, setArmed] = useState(gateway.vehicle.armed);
  const [showConfirm, setShowConfirm] = useState(false);
  const [commandState, setCommandState] = useState<CommandState>("idle");
  const commandInFlightRef = useRef(false);
  const commandResetTimerRef = useRef<number | null>(null);
  const [toast, setToast] = useState("正在连接 MAVLink 网关");
  const [mission, setMission] = useState(initialMission);
  const [missionSync, setMissionSync] = useState<MissionSyncState>(() => demoMode && gateway.mission.verified ? "verified" : "unknown");
  const missionRestoreAttemptRef = useRef(false);
  const [selectedMissionId, setSelectedMissionId] = useState<number | null>(null);
  const [missionDraft, setMissionDraft] = useState<MissionDraft | null>(null);
  const [planningMode, setPlanningMode] = useState(false);
  const [mapPickTarget, setMapPickTarget] = useState<MapPickTarget>("new");
  const [planHome, setPlanHome] = useState<[number, number]>(HOME);
  const [defaultAltitude, setDefaultAltitude] = useState(25);
  const [cruiseSpeed, setCruiseSpeed] = useState(7);
  const [altitudeHistory, setAltitudeHistory] = useState<number[]>(() => Array(16).fill(telemetry.altitude));
  const latestAltitudeRef = useRef(telemetry.altitude);
  latestAltitudeRef.current = telemetry.altitude;
  const missionBusy = !demoMode && (gateway.mission.state === "starting" || gateway.mission.state === "active");

  if (showExperiments) {
    return <ExperimentOneDashboard gateway={gateway} telemetry={telemetry} armed={gateway.vehicle.armed} onOpenLegacy={() => setShowExperiments(false)} />;
  }

  const currentPosition: [number, number] = [telemetry.longitude, telemetry.latitude];
  const hasPosition = Boolean(telemetry.longitude && telemetry.latitude);
  const actualHomePosition: [number, number] = gateway.home.valid ? [gateway.home.longitude, gateway.home.latitude] : HOME;
  const homePosition = activeView === "mission" ? planHome : actualHomePosition;
  const homeDistance = hasPosition ? distanceMeters(actualHomePosition, currentPosition) : 0;
  const routeDistance = mission.slice(1).reduce((sum, point, index) => sum + distanceMeters(mission[index].coordinates, point.coordinates), 0);
  const estimatedSeconds = routeDistance / Math.max(1, cruiseSpeed) + mission.reduce((sum, point) => sum + (point.command === "LOITER_TIME" ? point.param1 : 0), 0);

  useEffect(() => setMode(gateway.vehicle.mode), [gateway.vehicle.mode]);
  useEffect(() => setArmed(gateway.vehicle.armed), [gateway.vehicle.armed]);
  useEffect(() => {
    if (gateway.home.valid) setPlanHome([gateway.home.longitude, gateway.home.latitude]);
  }, [gateway.home.valid, gateway.home.longitude, gateway.home.latitude]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setAltitudeHistory((current) => [...current.slice(-15), latestAltitudeRef.current]);
    }, 3750);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setToast(gateway.connection.connected ? "MAVLink 飞控链路已连接" : "等待飞控心跳");
  }, [gateway.connection.connected]);
  useEffect(() => {
    if (demoMode) return;
    if (!gateway.connection.connected) {
      missionRestoreAttemptRef.current = false;
      return;
    }
    if (missionSync !== "unknown" || missionRestoreAttemptRef.current) return;
    missionRestoreAttemptRef.current = true;
    void getGateway<ApiResponse<MissionDownloadResult>>("/api/missions")
      .then((response) => {
        if (!response.result.verified) return;
        setMission(missionItemsToPoints(response.result.items));
        setMissionSync("verified");
        setToast("已从飞控恢复并校验航线");
      })
      .catch(() => {
        // An empty or incomplete flight-controller mission is a normal initial
        // state. The explicit upload action remains available to the operator.
      });
  }, [demoMode, gateway.connection.connected, missionSync]);

  const execute = async (
    message: string,
    request?: () => Promise<unknown>,
    callback?: (response: unknown) => void,
  ) => {
    // React state updates are asynchronous; a ref closes the same-tick
    // double-click window before `commandState` becomes pending.
    if (commandInFlightRef.current) return;
    commandInFlightRef.current = true;
    if (commandResetTimerRef.current !== null) {
      window.clearTimeout(commandResetTimerRef.current);
      commandResetTimerRef.current = null;
    }
    setCommandState("pending");
    setToast(`${message} · 等待飞控确认`);
    try {
      let response: unknown;
      if (demoMode) {
        await new Promise((resolve) => window.setTimeout(resolve, 700));
      } else if (request) {
        response = await request();
      }
      callback?.(response);
      setCommandState("success");
      setToast(`${message} · 飞控已接受`);
      commandResetTimerRef.current = window.setTimeout(() => setCommandState("idle"), 1200);
    } catch (error) {
      setCommandState("error");
      setToast(`${message} · ${error instanceof Error ? error.message : "命令失败"}`);
      commandResetTimerRef.current = window.setTimeout(() => setCommandState("idle"), 3500);
    } finally {
      commandInFlightRef.current = false;
    }
  };

  const changeMode = (nextMode: string, label = `切换 ${nextMode}`) => execute(
    label,
    () => sendGatewayCommand("/api/commands/mode", { mode: nextMode }),
    () => setMode(nextMode),
  );
  const confirmArm = () => {
    setShowConfirm(false);
    const nextArmed = !armed;
    void execute(
      armed ? "锁定" : "解锁",
      () => sendGatewayCommand("/api/commands/arm", { arm: nextArmed }),
      (response) => {
        const payload = response as { result?: { mode?: string } } | undefined;
        if (payload?.result?.mode) setMode(payload.result.mode);
        setArmed(nextArmed);
      },
    );
  };
  const handleFlightCommand = (action: FlightAction, value?: number) => {
    if (action === "takeoff") {
      void execute(`起飞至 ${value}m`, () => sendGatewayCommand("/api/commands/takeoff", { altitude: value }));
    } else if (action === "hold") {
      void execute("悬停", () => sendGatewayCommand("/api/commands/hold", {}), (response) => {
        const payload = response as { result?: { mode?: string } } | undefined;
        if (payload?.result?.mode) setMode(payload.result.mode);
      });
    } else if (action === "rtl") {
      void changeMode("RTL", "执行返航");
    } else if (action === "land") {
      void changeMode("LAND", "执行降落");
    } else if (action === "brake") {
      void changeMode("BRAKE", "执行刹停");
    }
  };
  const beginMissionDraft = (coordinates: [number, number] = [planHome[0] + 0.001, planHome[1] + 0.0005]) => {
    const next = createMissionDraft(coordinates, "WAYPOINT", defaultAltitude);
    setActiveView("mission");
    setSelectedMissionId(null);
    setMissionDraft(next);
    setPlanningMode(false);
  };
  const editMission = (point: MissionPoint) => {
    setActiveView("mission");
    setSelectedMissionId(point.id);
    setMissionDraft({ ...point, coordinates: [...point.coordinates] as [number, number] });
    setPlanningMode(false);
  };
  const saveMissionDraft = () => {
    if (!missionDraft) return;
    const normalized = { ...missionDraft, label: missionDraft.label.trim() || missionCommandLabel(missionDraft.command) };
    setMission((current) => {
      const existing = current.some((point) => point.id === normalized.id);
      let next = existing ? current.map((point) => point.id === normalized.id ? normalized : point) : [...current.slice(0, -1), normalized, current[current.length - 1]];
      if (normalized.command === "TAKEOFF") next = [normalized, ...next.filter((point) => point.id !== normalized.id && point.command !== "TAKEOFF")];
      if (isTerminalCommand(normalized.command)) next = [...next.filter((point) => point.id !== normalized.id && !isTerminalCommand(point.command)), normalized];
      return next;
    });
    setMissionSync("dirty");
    setSelectedMissionId(normalized.id);
    setMissionDraft(null);
    setToast("任务项已保存");
  };
  const removeMission = (id: number) => {
    setMission((current) => current.filter((point) => point.id !== id));
    setMissionSync("dirty");
    if (selectedMissionId === id) {
      setSelectedMissionId(null);
      setMissionDraft(null);
    }
  };
  const reorderMission = (sourceId: number, targetId: number) => {
    if (missionBusy) return;
    setMission((current) => {
      const sourceIndex = current.findIndex((point) => point.id === sourceId);
      const targetIndex = current.findIndex((point) => point.id === targetId);
      if (sourceIndex < 1 || targetIndex < 1 || sourceIndex === targetIndex) return current;
      if (isTerminalCommand(current[sourceIndex].command) || isTerminalCommand(current[targetIndex].command)) return current;
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      const insertAt = next.findIndex((point) => point.id === targetId);
      next.splice(insertAt, 0, moved);
      return next;
    });
    setMissionSync("dirty");
    setSelectedMissionId(sourceId);
    setToast("任务顺序已更新，请重新上传并校验");
  };
  const moveMission = (id: number, coordinates: [number, number]) => {
    if (missionBusy) return;
    setMission((current) => current.map((point) => point.id === id ? { ...point, coordinates } : point));
    setMissionSync("dirty");
    setSelectedMissionId(id);
    setToast("航点位置已更新，请重新上传并校验");
  };
  const pickOnMap = () => {
    setMapPickTarget("editor");
    setPlanningMode(true);
    setToast("请在地图上点击新的坐标");
  };
  const handleMapPick = (coordinates: [number, number]) => {
    if (mapPickTarget === "home") {
      setPlanHome(coordinates);
      setPlanningMode(false);
      setMapPickTarget("new");
      setMissionSync("dirty");
      setToast("规划起始点已更新；飞控实际 Home 仍由解锁位置决定");
      return;
    }
    if (mapPickTarget === "editor" && missionDraft) {
      setMissionDraft({ ...missionDraft, coordinates });
      setPlanningMode(false);
      setToast("坐标已更新，请保存任务项");
      return;
    }
    const next = createMissionDraft(coordinates, "WAYPOINT", defaultAltitude);
    setMission((current) => [...current.slice(0, -1), next, current[current.length - 1]]);
    setMissionSync("dirty");
    setSelectedMissionId(next.id);
    setMissionDraft({ ...next, coordinates: [...next.coordinates] as [number, number] });
    setToast("航点已添加；继续点击地图可连续添加");
  };
  const createSurveyPattern = () => {
    if (missionBusy) return;
    const longitudeStep = 0.00115;
    const latitudeStep = 0.00072;
    const generated = [
      [planHome[0] + longitudeStep, planHome[1] + latitudeStep],
      [planHome[0] + longitudeStep * 2.2, planHome[1] + latitudeStep],
      [planHome[0] + longitudeStep * 2.2, planHome[1] + latitudeStep * 1.8],
      [planHome[0] + longitudeStep, planHome[1] + latitudeStep * 1.8],
    ].map((coordinates, index) => ({
      ...createMissionDraft(coordinates as [number, number], "WAYPOINT", defaultAltitude),
      id: nextMissionId() + index,
      label: `测绘航点 ${index + 1}`,
    }));
    setMission((current) => [current[0], ...generated, current[current.length - 1]]);
    setSelectedMissionId(generated[0].id);
    setMissionDraft({ ...generated[0], coordinates: [...generated[0].coordinates] as [number, number] });
    setMissionSync("dirty");
    setPlanningMode(false);
    setToast("已生成区域测绘航线，可拖动航点调整覆盖范围");
  };
  const uploadMission = () => {
    const items = mission.map((point) => ({
      command: point.command,
      latitude: point.coordinates[1],
      longitude: point.coordinates[0],
      altitude: point.altitude,
      param1: point.param1,
      param2: point.param2,
      param3: point.param3,
      param4: point.param4,
    }));
    void execute(
      "上传并校验航线",
      () => sendGatewayCommand("/api/missions/upload", { items, verify: true }),
      () => {
        setMissionSync("verified");
        missionRestoreAttemptRef.current = true;
      },
    );
  };
  const readMission = () => {
    void execute(
      "从飞控读取航线",
      () => getGateway<ApiResponse<MissionDownloadResult>>("/api/missions"),
      (response) => {
        if (demoMode || !response) return;
        const result = (response as ApiResponse<MissionDownloadResult>).result;
        const downloaded = result.items;
        const supported = new Set(["TAKEOFF", "WAYPOINT", "LOITER_TIME", "RTL", "LAND"]);
        const unsupported = downloaded.find((item) => !supported.has(item.command));
        if (unsupported) throw new Error(`航线包含暂不支持的命令 ${unsupported.command}`);
        setMission(missionItemsToPoints(downloaded));
        setMissionSync(result.verified ? "verified" : "unknown");
        missionRestoreAttemptRef.current = true;
        if (!result.verified && result.validationError) throw new Error(result.validationError);
      },
    );
  };
  const startMission = () => {
    void execute("执行航线任务", () => sendGatewayCommand("/api/missions/start", {}));
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Navigation size={20} /></div><div><strong>MUVA</strong><span>飞行控制台</span></div></div>
        <div className="vehicle-identity"><span>IRIS-01</span><small>ArduCopter SITL</small></div>
        <div className="topbar-statuses">
          <StatusItem icon={<Wifi size={15} />} label="链路" value={gateway.connection.connected ? "已连接" : "离线"} accent={gateway.connection.connected} />
          <StatusItem icon={<Satellite size={15} />} label="GPS" value={`${telemetry.satellites} 星`} />
          <StatusItem icon={<BatteryMedium size={16} />} label="电池" value={telemetry.battery >= 0 ? `${telemetry.battery}%` : "--"} />
          <StatusItem icon={<Gauge size={16} />} label="高度" value={`${telemetry.altitude.toFixed(1)} m`} />
        </div>
        <div className="header-actions"><span className={`flight-state ${armed ? "armed" : ""}`}><i />{armed ? "ARMED" : "SAFE"}</span><IconButton label="主菜单"><Menu size={19} /></IconButton></div>
      </header>
      <div className="workspace">
        <nav className="nav-rail" aria-label="主导航">
          <div className="nav-main">
            <button className={activeView === "flight" ? "active" : ""} onClick={() => setActiveView("flight")}><MapIcon size={20} /><span>飞行</span></button>
            <button className={activeView === "mission" ? "active" : ""} onClick={() => setActiveView("mission")}><Route size={20} /><span>规划</span></button>
            <button className={activeView === "system" ? "active" : ""} onClick={() => setActiveView("system")}><Activity size={20} /><span>系统</span></button>
          </div>
          <button className="nav-settings"><Settings2 size={20} /><span>设置</span></button>
        </nav>
        <main className={`dashboard-grid ${activeView === "mission" ? "planning-dashboard" : ""}`}>
          {activeView !== "mission" && <TelemetryPanel telemetry={telemetry} connected={gateway.connection.connected} homeDistance={homeDistance} altitudeHistory={altitudeHistory} />}
          <FlightMap mission={mission} heading={telemetry.heading} coordinates={currentPosition} home={homePosition} track={gateway.track} routeDistance={routeDistance} planningView={activeView === "mission"} planningMode={planningMode} selectedMissionId={selectedMissionId} missionBusy={missionBusy} onTogglePlanning={() => { if (missionBusy) return; setMapPickTarget("new"); setPlanningMode((current) => !current); }} onMapPick={handleMapPick} onMarkerSelect={(id) => { if (missionBusy) return; const point = mission.find((item) => item.id === id); if (point) editMission(point); }} onMarkerMove={moveMission} onCreateSurvey={createSurveyPattern} onPickHome={() => { setMapPickTarget("home"); setPlanningMode(true); setToast("点击地图设置规划起始点"); }} />
          <ActivityPanel activeView={activeView} messages={gateway.messages} demoMode={demoMode} monitor={monitor} />
          <ControlPanel
            activeView={activeView}
            connected={gateway.connection.connected}
            armed={armed}
            mode={mode}
            endpoint={gateway.connection.endpoint}
            heartbeatAgeMs={gateway.connection.lastHeartbeatAgeMs}
            activeMission={gateway.mission}
            missionSync={missionSync}
            missionBusy={missionBusy}
            commandState={commandState}
            mission={mission}
            selectedMissionId={selectedMissionId}
            missionDraft={missionDraft}
            routeDistance={routeDistance}
            estimatedSeconds={estimatedSeconds}
            planHome={planHome}
            actualHome={gateway.home}
            defaultAltitude={defaultAltitude}
            cruiseSpeed={cruiseSpeed}
            onModeChange={(nextMode) => void changeMode(nextMode)}
            onArm={() => setShowConfirm(true)}
            onCommand={handleFlightCommand}
            onRemoveMission={removeMission}
            onAddMission={() => beginMissionDraft()}
            onEditMission={editMission}
            onDraftChange={setMissionDraft}
            onSaveDraft={saveMissionDraft}
            onCancelDraft={() => { setMissionDraft(null); setSelectedMissionId(null); }}
            onPickEditorMap={pickOnMap}
            onMissionRead={readMission}
            onMissionUpload={uploadMission}
            onMissionStart={startMission}
            onReorderMission={reorderMission}
            onDefaultAltitudeChange={setDefaultAltitude}
            onCruiseSpeedChange={setCruiseSpeed}
          />
        </main>
      </div>
      <div className={`command-toast ${commandState}`}><Radio size={15} /><span>{toast}</span>{commandState === "pending" && <i />}</div>
      {showConfirm && <ConfirmDialog armed={armed} onClose={() => setShowConfirm(false)} onConfirm={confirmArm} />}
    </div>
  );
}
