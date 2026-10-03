import { Crosshair } from 'lucide-react';

import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { FlightSceneViewport } from '../../../../components/map/FlightSceneViewport';
import { useExperimentStore } from '../../../../stores/experimentStore';
import { useFlightStore } from '../../../../stores/flightStore';
import { useRoutePlannerStore } from '../../../../stores/routePlannerStore';
import { useTelemetryStore } from '../../../../stores/telemetryStore';
import { useTrainingStore } from '../../../../stores/trainingStore';

export function FlightViewPanel() {
  const activeTask = useTrainingStore((state) => state.tasks.find((task) => task.status === 'ACTIVE'));
  const flightStatus = useFlightStore((state) => state.status);
  const flightPath = useTelemetryStore((state) => state.flightPath);
  const mapHome = useTelemetryStore((state) => state.mapHome);
  const telemetryAvailability = useTelemetryStore((state) => state.availability);
  const maxAltitudeMeters = useExperimentStore((state) => state.configuration.flightParameters.maxAltitude);
  const plannerOpen = useRoutePlannerStore((state) => state.isOpen);
  const plannerPhase = useRoutePlannerStore((state) => state.phase);
  const plannedWaypoints = useRoutePlannerStore((state) => state.waypoints);
  const plannedAltitude = useRoutePlannerStore((state) => state.altitudeMeters);
  const plannerError = useRoutePlannerStore((state) => state.error);
  const addWaypoint = useRoutePlannerStore((state) => state.addWaypoint);
  const undoWaypoint = useRoutePlannerStore((state) => state.undoWaypoint);
  const clearWaypoints = useRoutePlannerStore((state) => state.clearWaypoints);
  const cancelPlanning = useRoutePlannerStore((state) => state.cancel);
  const setPlannedAltitude = useRoutePlannerStore((state) => state.setAltitude);
  const executeRoute = useRoutePlannerStore((state) => state.execute);
  const trainingTasks = useTrainingStore((state) => state.tasks);
  const home = mapHome ?? flightStatus.homePosition;
  const vehicleReady = flightStatus.mavlinkStatus.connected && telemetryAvailability === 'AVAILABLE';
  const basicTrainingComplete = trainingTasks.length > 0 && trainingTasks.every((task) => task.status === 'COMPLETED');

  return (
    <PanelShell
      title="飞行任务视图"
      icon={Crosshair}
      action={<span>Gazebo 遥测 · 实时 2D 轨迹</span>}
      emphasis="primary"
    >
      <FlightSceneViewport
        altitudeMeters={flightStatus.position.altitude}
        armed={flightStatus.armed}
        currentTask={activeTask?.title ?? '待命'}
        speedMetersPerSecond={flightStatus.groundSpeed}
        latitude={flightStatus.position.latitude}
        longitude={flightStatus.position.longitude}
        home={mapHome ?? flightStatus.homePosition}
        north={flightStatus.north}
        east={flightStatus.east}
        yaw={flightStatus.yaw}
        mode={flightStatus.mode}
        flightPath={flightPath}
        routePlanner={{
          visible: plannerOpen,
          editable: plannerPhase === 'PLANNING' || plannerPhase === 'ERROR',
          phase: plannerPhase,
          waypoints: plannedWaypoints,
          altitudeMeters: plannedAltitude,
          maxAltitudeMeters,
          vehicleReady,
          error: plannerError,
          onAddWaypoint: addWaypoint,
          onUndo: undoWaypoint,
          onClear: clearWaypoints,
          onCancel: cancelPlanning,
          onAltitudeChange: (altitudeMeters) => setPlannedAltitude(Math.min(maxAltitudeMeters, altitudeMeters)),
          onExecute: () => { void executeRoute({ home, armed: flightStatus.armed, vehicleReady, basicTrainingComplete }); },
        }}
      />
    </PanelShell>
  );
}
