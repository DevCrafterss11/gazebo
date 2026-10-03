import { useExperimentStore } from '../../../../stores/experimentStore';
import styles from './WorkflowSteps.module.css';

export function ConfigurationSummary() {
  const selectedDrone = useExperimentStore((state) => state.selectedDrone);
  const selectedScene = useExperimentStore((state) => state.selectedScene);
  const configuration = useExperimentStore((state) => state.configuration);
  const controller = configuration.flightController;
  const parameters = configuration.flightParameters;
  const healthySensors = configuration.sensors.filter((sensor) => sensor.status === 'PASS').length;

  return (
    <dl className={styles.configurationSummary}>
      <div><dt>无人机型号</dt><dd>{selectedDrone?.name ?? '未选择'}</dd></div>
      <div><dt>飞控</dt><dd>{controller.autopilot} · {controller.vehicleType}</dd></div>
      <div><dt>固件 / 构型</dt><dd>{controller.firmware} · {controller.frameClass} {controller.frameType}</dd></div>
      <div><dt>默认模式</dt><dd>{controller.flightMode} · {controller.protocol}</dd></div>
      <div><dt>系统检查</dt><dd>{healthySensors}/{configuration.sensors.length} PASS</dd></div>
      <div><dt>飞行参数</dt><dd>{parameters.takeoffAltitude}m 起飞 · {parameters.maxSpeed}m/s</dd></div>
      <div><dt>RTL / 悬停</dt><dd>{parameters.rtlAltitude}m · {parameters.hoverDuration}s</dd></div>
      <div><dt>场景</dt><dd>{selectedScene?.name ?? '未选择'}</dd></div>
      <div><dt>Home Point</dt><dd>{configuration.homePosition ? `${configuration.homePosition.latitude.toFixed(4)}, ${configuration.homePosition.longitude.toFixed(4)} · ${configuration.homePosition.altitude}m` : '未设置'}</dd></div>
    </dl>
  );
}
