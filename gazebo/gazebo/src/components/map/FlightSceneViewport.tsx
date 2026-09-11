import { Crosshair, Home, Navigation, Rotate3d } from 'lucide-react';

import styles from './FlightSceneViewport.module.css';

interface FlightSceneViewportProps {
  currentTask: string;
  altitudeMeters: number;
  speedMetersPerSecond: number;
  north: number;
  east: number;
  yaw: number;
  flightPath: Array<{ north: number; east: number }>;
  mode: string;
}

export function FlightSceneViewport({
  currentTask,
  altitudeMeters,
  speedMetersPerSecond,
  north,
  east,
  yaw,
  flightPath,
  mode,
}: FlightSceneViewportProps) {
  const markerLeft = Math.min(92, Math.max(8, 50 + east * 1.2));
  const markerTop = Math.min(87, Math.max(13, 52 - north * 1.2));
  const pathPoints = flightPath.slice(-120).map((point) => `${Math.min(92, Math.max(8, 50 + point.east * 1.2))},${Math.min(87, Math.max(13, 52 - point.north * 1.2))}`).join(' ');
  return (
    <div className={styles.viewport} aria-label="Gazebo 飞行训练场景视图">
      <div className={styles.sceneBlocks} aria-hidden="true">
        <span /><span /><span /><span /><span /><span />
      </div>
      <div className={styles.taskBanner}>
        <Crosshair size={16} />
        <span>当前任务</span>
        <strong>{currentTask}</strong>
        <small>保持高度与位置稳定</small>
      </div>
      <div className={styles.compass}><strong>N</strong><Navigation size={18} /></div>
      <div className={styles.route} aria-hidden="true">
        <span className={styles.startPoint}><Home size={14} /></span>
        <span className={styles.taskPointOne}>1</span>
        <span className={styles.taskPoint}>2</span>
        <span className={styles.taskPointThree}>3</span>
        {pathPoints ? <svg className={styles.flightPath} viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={pathPoints} /></svg> : null}
        <span className={styles.droneMarker} style={{ left: `${markerLeft}%`, top: `${markerTop}%`, transform: `translate(-50%, -50%) rotate(${yaw}deg)` }}>
          <i className={styles.rotorHorizontal} />
          <i className={styles.rotorVertical} />
          <i className={styles.droneCore} />
        </span>
      </div>
      <div className={styles.telemetryHud}>
        <div><span>ALT</span><strong>{altitudeMeters.toFixed(1)} m</strong></div>
        <div><span>SPEED</span><strong>{speedMetersPerSecond.toFixed(1)} m/s</strong></div>
        <div><span>MODE</span><strong>{mode}</strong></div>
      </div>
      <div className={styles.viewLabel}>
        <Rotate3d size={15} />
        <div>
          <strong>校园训练场景</strong>
          <span>Gazebo / WebRTC 视图适配层</span>
        </div>
      </div>
    </div>
  );
}
