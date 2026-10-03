import { Check, ChevronRight, LoaderCircle, Route } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useExperimentStore } from '../../../../stores/experimentStore';
import { useFlightStore } from '../../../../stores/flightStore';
import { useRoutePlannerStore } from '../../../../stores/routePlannerStore';
import { useTrainingStore } from '../../../../stores/trainingStore';
import styles from './Panels.module.css';

const busyPhases = new Set(['UPLOADING', 'ARMING', 'STARTING']);

export function CustomRouteButton() {
  const isOpen = useRoutePlannerStore((state) => state.isOpen);
  const phase = useRoutePlannerStore((state) => state.phase);
  const waypointCount = useRoutePlannerStore((state) => state.waypoints.length);
  const open = useRoutePlannerStore((state) => state.open);
  const close = useRoutePlannerStore((state) => state.close);
  const markCompleted = useRoutePlannerStore((state) => state.markCompleted);
  const takeoffAltitude = useExperimentStore((state) => state.configuration.flightParameters.takeoffAltitude);
  const armed = useFlightStore((state) => state.status.armed);
  const altitude = useFlightStore((state) => state.status.position.altitude);
  const tasks = useTrainingStore((state) => state.tasks);
  const observedFlightRef = useRef(false);
  const isBusy = busyPhases.has(phase);
  const basicTrainingComplete = tasks.length > 0 && tasks.every((task) => task.status === 'COMPLETED');
  const locked = !basicTrainingComplete && phase !== 'RUNNING';
  const status = phase === 'RUNNING'
    ? `执行中 · ${waypointCount} 航点`
    : phase === 'COMPLETED'
      ? `已完成 · ${waypointCount} 航点`
      : waypointCount > 0
        ? `已选择 ${waypointCount} 个航点`
        : locked ? '完成基础训练后解锁' : '地图选点并执行';

  useEffect(() => {
    if (phase !== 'RUNNING') {
      observedFlightRef.current = false;
      return;
    }
    if (armed || altitude > 0.5) observedFlightRef.current = true;
    if (observedFlightRef.current && !armed && altitude < 0.3) markCompleted();
  }, [altitude, armed, markCompleted, phase]);

  return (
    <button
      className={`${styles.routeLauncher} ${isOpen ? styles.routeLauncherActive : ''}`}
      type="button"
      aria-expanded={isOpen}
      aria-disabled={locked}
      disabled={locked}
      title={locked ? '请先完成基础飞行训练的全部操作' : '在地图上规划并执行自定义航线'}
      onClick={() => (isOpen ? close() : open(takeoffAltitude))}
    >
      <span className={styles.routeLauncherIcon}><Route size={19} /></span>
      <span className={styles.routeLauncherText}><strong>自定义航线</strong><small>{status}</small></span>
      {isBusy ? <LoaderCircle className={styles.routeLauncherSpinner} size={18} /> : phase === 'COMPLETED' ? <Check size={18} /> : <ChevronRight size={18} />}
    </button>
  );
}
