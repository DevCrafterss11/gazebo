import {
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpFromLine,
  CornerUpLeft,
  CornerUpRight,
  Pause,
  RotateCcw,
} from 'lucide-react';
import { useState } from 'react';

import { ConfirmDialog } from '../common/ConfirmDialog/ConfirmDialog';
import styles from './FlightControlSurface.module.css';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { useFlightStore } from '../../stores/flightStore';
import { useExperimentStore } from '../../stores/experimentStore';
import { useTelemetryStore } from '../../stores/telemetryStore';

export function FlightControlSurface() {
  const arm = useFlightStore((state) => state.arm);
  const disarm = useFlightStore((state) => state.disarm);
  const takeoff = useFlightStore((state) => state.takeoff);
  const land = useFlightStore((state) => state.land);
  const rtl = useFlightStore((state) => state.rtl);
  const hold = useFlightStore((state) => state.hold);
  const move = useFlightStore((state) => state.move);
  const takeoffAltitude = useExperimentStore((state) => state.configuration.flightParameters.takeoffAltitude);
  const pendingCommand = useFlightStore((state) => state.pendingCommand);
  const commandError = useFlightStore((state) => state.commandError);
  const vehicleReady = useEnvironmentStore((state) => state.runtime.vehicle === 'ONLINE');
  const telemetryAvailability = useTelemetryStore((state) => state.availability);
  const [confirmingLand, setConfirmingLand] = useState(false);
  const controlsDisabled = !vehicleReady || telemetryAvailability !== 'AVAILABLE' || pendingCommand !== null;
  const disabledReason = !vehicleReady
    ? '仿真环境未就绪，请先完成实验一环境启动'
    : telemetryAvailability !== 'AVAILABLE'
      ? 'Telemetry Lost，请等待遥测连接恢复'
      : '正在执行上一条飞行命令';

  return (
    <div className={styles.surface}>
      {pendingCommand || commandError ? (
        <div className={`${styles.commandToast} ${commandError ? styles.commandToastError : ''}`} role="status">
          {commandError ?? `${pendingCommand} 命令已发送...`}
        </div>
      ) : null}
      {!vehicleReady && !commandError ? (
        <div className={`${styles.commandToast} ${styles.commandToastWarning}`} role="status">
          当前没有已启动的仿真实验，飞行控制已锁定。
        </div>
      ) : null}
      <div className={styles.directionGroup}>
        <span className={styles.groupLabel}>水平移动</span>
        <div className={styles.directionPad}>
          <button className={styles.forward} type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : '向前移动 5 米'} onClick={() => void move('forward')}><ArrowUp size={17} /><span>前进</span></button>
          <button className={styles.left} type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : '向左移动 5 米'} onClick={() => void move('left')}><ArrowLeft size={17} /><span>左移</span></button>
          <button className={styles.hold} type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : '保持当前位置与高度'} onClick={() => void hold()}><Pause size={17} /><span>悬停</span></button>
          <button className={styles.right} type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : '向右移动 5 米'} onClick={() => void move('right')}><ArrowRight size={17} /><span>右移</span></button>
          <button className={styles.backward} type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : '向后移动 5 米'} onClick={() => void move('backward')}><ArrowDown size={17} /><span>后退</span></button>
        </div>
      </div>
      <div className={styles.axisGroup}>
        <span className={styles.groupLabel}>高度 / 偏航</span>
        <div className={styles.axisControls}>
          <button type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : '上升 1 米'} onClick={() => void move('up')}><ArrowUpFromLine size={16} /><span>上升</span></button>
          <button type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : '下降 1 米'} onClick={() => void move('down')}><ArrowDownToLine size={16} /><span>下降</span></button>
          <button type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : '向左偏航 15 度'} onClick={() => void move('yaw-left')}><CornerUpLeft size={16} /><span>左转</span></button>
          <button type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : '向右偏航 15 度'} onClick={() => void move('yaw-right')}><CornerUpRight size={16} /><span>右转</span></button>
        </div>
      </div>
      <div className={styles.commandGroup}>
        <button className={styles.armButton} type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : '解锁无人机'} onClick={() => void arm()}><span>ARM</span><small>解锁</small></button>
        <button className={styles.disarmButton} type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : '锁定无人机'} onClick={() => void disarm()}><span>DISARM</span><small>上锁</small></button>
        <button className={styles.takeoffButton} type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : `起飞至 ${takeoffAltitude} 米`} onClick={() => void takeoff(takeoffAltitude)}><span>TAKEOFF</span><small>{takeoffAltitude}m 起飞</small></button>
        <button className={styles.landButton} type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : '安全降落'} onClick={() => setConfirmingLand(true)}><span>LAND</span><small>降落</small></button>
        <button className={styles.rtlButton} type="button" disabled={controlsDisabled} title={controlsDisabled ? disabledReason : '返回 Home Point'} onClick={() => void rtl()}><RotateCcw size={16} /><span>RTL</span><small>返航</small></button>
      </div>
      {confirmingLand ? (
        <ConfirmDialog
          title="确认降落"
          description="无人机将按安全速率下降并在接地后自动上锁。"
          onCancel={() => setConfirmingLand(false)}
          onConfirm={async () => { setConfirmingLand(false); await land(); }}
          confirmLabel="确认降落"
        />
      ) : null}
    </div>
  );
}
