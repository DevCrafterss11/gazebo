import type { FlightFrame, SimulationSnapshot } from '../../../domain/assessment/model';
import { getExperiment3Scene, type Experiment3Scene, type GeoPoint } from '../../../domain/assessment/experiment3Scenes';
import styles from './Experiment3Scenes.module.css';

interface Experiment3MapProps {
  scene?: string | null;
  flight?: SimulationSnapshot;
  trajectory?: FlightFrame[];
  showFlightPath?: boolean;
  className?: string;
}

const METERS_PER_DEGREE = 111111;
const clamp = (value: number) => Math.min(100, Math.max(0, value));
const heading = (value: number) => ((value % 360) + 360) % 360;

function toGeoPoint(scene: Experiment3Scene, east: number, south: number): GeoPoint {
  const longitudeScale = METERS_PER_DEGREE * Math.cos(scene.home.latitude * Math.PI / 180);
  return {
    latitude: scene.home.latitude - south / METERS_PER_DEGREE,
    longitude: scene.home.longitude + east / longitudeScale,
  };
}

function toMapPoint(scene: Experiment3Scene, point: GeoPoint): { x: number; y: number } {
  const longitudeScale = METERS_PER_DEGREE * Math.cos(scene.center.latitude * Math.PI / 180);
  const east = (point.longitude - scene.center.longitude) * longitudeScale;
  const north = (point.latitude - scene.center.latitude) * METERS_PER_DEGREE;
  return {
    x: clamp(50 + east / scene.extentMeters.width * 100),
    y: clamp(50 - north / scene.extentMeters.height * 100),
  };
}

function localToMapPoint(scene: Experiment3Scene, east: number, south: number): { x: number; y: number } {
  return toMapPoint(scene, toGeoPoint(scene, east, south));
}

function pointList(scene: Experiment3Scene, trajectory: FlightFrame[]): string {
  return trajectory.map((frame) => {
    const point = localToMapPoint(scene, frame.x, frame.z);
    return `${point.x},${point.y}`;
  }).join(' ');
}

function QuadcopterMarker({ position, yaw }: { position: { x: number; y: number }; yaw: number }) {
  return <div className={styles.uavMarker} style={{ left: `${position.x}%`, top: `${position.y}%` }} aria-label={`四旋翼无人机，航向 ${heading(yaw).toFixed(0)} 度`}>
    <svg viewBox="0 0 120 120" role="img" aria-hidden="true">
      <g transform={`rotate(${heading(yaw)} 60 60)`}>
        <path className={styles.uavArm} d="M35 35 L85 85 M85 35 L35 85" />
        <circle className={styles.uavRotor} cx="28" cy="28" r="16" />
        <circle className={styles.uavRotor} cx="92" cy="28" r="16" />
        <circle className={styles.uavRotor} cx="28" cy="92" r="16" />
        <circle className={styles.uavRotor} cx="92" cy="92" r="16" />
        <path className={styles.uavBody} d="M60 31 L74 55 L68 78 L52 78 L46 55 Z" />
        <path className={styles.uavNose} d="M60 27 L53 39 L67 39 Z" />
        <circle className={styles.uavCore} cx="60" cy="59" r="6" />
      </g>
    </svg>
  </div>;
}

function MapPoint({ point, kind, label }: { point: { x: number; y: number }; kind: 'home' | 'target'; label: string }) {
  return <div className={`${styles.mapPoint} ${kind === 'home' ? styles.homePoint : styles.targetPoint}`} style={{ left: `${point.x}%`, top: `${point.y}%` }}>
    <span className={styles.pointGlyph}>{kind === 'home' ? 'H' : 'T'}</span>
    <span>{label}</span>
  </div>;
}

export function Experiment3Map({ scene: sceneId, flight, trajectory = [], showFlightPath = false, className = '' }: Experiment3MapProps) {
  const scene = getExperiment3Scene(sceneId);
  if (!scene) return <div className={`${styles.mapViewport} ${className}`}><div className={styles.mapEmpty}>请选择实验三训练场景</div></div>;

  const home = toMapPoint(scene, scene.home);
  const target = toMapPoint(scene, scene.target);
  const live = flight && flight.telemetryTimestamp > 0 ? localToMapPoint(scene, flight.position.x, flight.position.z) : home;
  const liveYaw = flight?.telemetryTimestamp ? flight.attitude.yaw : 0;
  const path = trajectory.length > 1 ? pointList(scene, trajectory) : '';
  const boundaryWidth = scene.safeRadius / scene.extentMeters.width * 200;
  const boundaryHeight = scene.safeRadius / scene.extentMeters.height * 200;

  return <div className={`${styles.mapViewport} ${className}`} data-scene-id={scene.id} data-map-zoom={scene.zoom}>
    <img className={styles.mapImage} src={scene.mapImage} alt={`${scene.name}卫星地图`} />
    <div className={styles.mapShade} />
    <svg className={styles.mapOverlay} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`${scene.name}二维卫星地图`}>
      <ellipse className={styles.mapBoundary} cx={home.x} cy={home.y} rx={boundaryWidth / 2} ry={boundaryHeight / 2} />
      {showFlightPath && path && <polyline className={styles.flightPath} points={path} />}
    </svg>
    <MapPoint point={home} kind="home" label="Home" />
    <MapPoint point={target} kind="target" label="Target" />
    <QuadcopterMarker position={live} yaw={liveYaw} />
    <div className={styles.mapLegend}><span><i className={styles.legendHome} />Home</span><span><i className={styles.legendTarget} />Target</span><span><i className={styles.legendBoundary} />安全边界</span></div>
    <span className={styles.credit}>二维卫星地图 · {scene.name} · Z{scene.zoom}</span>
  </div>;
}
