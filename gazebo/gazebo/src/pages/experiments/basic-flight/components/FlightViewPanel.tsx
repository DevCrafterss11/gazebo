import { Crosshair } from 'lucide-react';

import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { FlightSceneViewport } from '../../../../components/map/FlightSceneViewport';
import { useFlightStore } from '../../../../stores/flightStore';
import { useTelemetryStore } from '../../../../stores/telemetryStore';
import { useTrainingStore } from '../../../../stores/trainingStore';

export function FlightViewPanel() {
  const activeTask = useTrainingStore((state) => state.tasks.find((task) => task.status === 'ACTIVE'));
  const flightStatus = useFlightStore((state) => state.status);
  const samples = useTelemetryStore((state) => state.samples);

  return (
    <PanelShell
      title="飞行任务视图"
      icon={Crosshair}
      action={<span>Gazebo 场景 · 3D 视图</span>}
      emphasis="primary"
    >
      <FlightSceneViewport
        altitudeMeters={flightStatus.position.altitude}
        currentTask={activeTask?.title ?? '待命'}
        speedMetersPerSecond={flightStatus.groundSpeed}
        north={flightStatus.north}
        east={flightStatus.east}
        yaw={flightStatus.yaw}
        mode={flightStatus.mode}
        flightPath={samples.map((sample) => ({ north: sample.north ?? 0, east: sample.east ?? 0 }))}
      />
    </PanelShell>
  );
}
