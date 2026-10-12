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

interface FlightControlSurfaceProps {
  forwardStepMeters?: number;
  verticalStepMeters?: number;
  requirePreflight?: boolean;
}

export function FlightControlSurface({ forwardStepMeters = 5, verticalStepMeters = 1, requirePreflight = false }: FlightControlSurfaceProps) {
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
  const armed = useFlightStore((state) => state.status.armed);
  const altitude = useFlightStore((state) => state.status.position.altitude);
  const preflightPassed = useExperimentStore((state) => state.preflightPassed);
  const [confirmingLand, setConfirmingLand] = useState(false);
  const controlsDisabled = !vehicleReady || telemetryAvailability !== 'AVAILABLE' || pendingCommand !== null || requirePreflight && !preflightPassed;
  const airborne = armed && altitude > 0.2;
  const motionDisabled = controlsDisabled || !airborne;
  const disabledReason = !vehicleReady
    ? '仿真环境未就绪，请先完成实验一环境启动'
    : telemetryAvailability !== 'AVAILABLE'
      ? 'Telemetry Lost，请等待遥测连接恢复'
      : requirePreflight && !preflightPassed ? '请先完成传感器检查与起飞前检查' : '正在执行上一条飞行命令';
  const motionReason = controlsDisabled ? disabledReason : '请先解锁并起飞，再执行空中操控';

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
          <button className={styles.forward} type="button" disabled={motionDisabled} title={motionDisabled ? motionReason : `向前移动 ${forwardStepMeters} 米`} onClick={() => void move('forward', forwardStepMeters)}><ArrowUp size={17} /><span>前进</span></button>
          <button className={styles.left} type="button" disabled={motionDisabled} title={motionDisabled ? motionReason : '向左移动 5 米'} onClick={() => void move('left')}><ArrowLeft size={17} /><span>左移</span></button>
          <button className={styles.hold} type="button" disabled={motionDisabled} title={motionDisabled ? motionReason : '保持当前位置与高度'} onClick={() => void hold()}><Pause size={17} /><span>悬停</span></button>
          <button className={styles.right} type="button" disabled={motionDisabled} title={motionDisabled ? motionReason : '向右移动 5 米'} onClick={() => void move('right')}><ArrowRight size={17} /><span>右移</span></button>
          <button className={styles.backward} type="button" disabled={motionDisabled} title={motionDisabled ? motionReason : '向后移动 5 米'} onClick={() => void move('backward')}><ArrowDown size={17} /><span>后退</span></button>
        </div>
      </div>
      <div className={styles.axisGroup}>
        <span className={styles.groupLabel}>高度 / 偏航</span>
        <div className={styles.axisControls}>
          <button type="button" disabled={motionDisabled} title={motionDisabled ? motionReason : `上升 ${verticalStepMeters} 米`} onClick={() => void move('up', verticalStepMeters)}><ArrowUpFromLine size={16} /><span>上升</span></button>
          <button type="button" disabled={motionDisabled} title={motionDisabled ? motionReason : `下降 ${verticalStepMeters} 米`} onClick={() => void move('down', verticalStepMeters)}><ArrowDownToLine size={16} /><span>下降</span></button>
          <button type="button" disabled={motionDisabled} title={motionDisabled ? motionReason : '向左偏航 15 度'} onClick={() => void move('yaw-left')}><CornerUpLeft size={16} /><span>左转</span></button>
          <button type="button" disabled={motionDisabled} title={motionDisabled ? motionReason : '向右偏航 15 度'} onClick={() => void move('yaw-right')}><CornerUpRight size={16} /><span>右转</span></button>
        </div>
      </div>
      <div className={styles.commandGroup}>
        <button className={styles.armButton} type="button" disabled={controlsDisabled || armed} title={controlsDisabled ? disabledReason : armed ? '无人机已解锁' : '解锁无人机'} onClick={() => void arm()}><span>ARM</span><small>解锁</small></button>
        <button className={styles.disarmButton} type="button" disabled={controlsDisabled || !armed || airborne} title={controlsDisabled ? disabledReason : airborne ? '飞行中禁止上锁，请先安全降落' : !armed ? '无人机已上锁' : '锁定无人机'} onClick={() => void disarm()}><span>DISARM</span><small>上锁</small></button>
        <button className={styles.takeoffButton} type="button" disabled={controlsDisabled || !armed || airborne} title={controlsDisabled ? disabledReason : !armed ? '请先执行 ARM 解锁' : airborne ? '无人机已起飞' : `起飞至 ${takeoffAltitude} 米`} onClick={() => void takeoff(takeoffAltitude)}><span>TAKEOFF</span><small>{takeoffAltitude}m 起飞</small></button>
        <button className={styles.landButton} type="button" disabled={controlsDisabled || !armed} title={controlsDisabled ? disabledReason : !armed ? '无人机未解锁' : '安全降落'} onClick={() => setConfirmingLand(true)}><span>LAND</span><small>降落</small></button>
        <button className={styles.rtlButton} type="button" disabled={motionDisabled} title={motionDisabled ? motionReason : '只返航至 Home，不自动降落'} onClick={() => void rtl()}><RotateCcw size={16} /><span>RTL</span><small>返航至 Home</small></button>
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
