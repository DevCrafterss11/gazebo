import { Crosshair } from 'lucide-react';
import { useMemo } from 'react';

import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { FlightSceneViewport } from '../../../../components/map/FlightSceneViewport';
import { flightMapContextId, rebaseMapCoordinates, validMapCoordinates } from '../../../../domain/flightMap';
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
  const latest = useTelemetryStore((state) => state.latest);
  const mapError = useTelemetryStore((state) => state.mapError);
  const refreshMap = useTelemetryStore((state) => state.refreshMap);
  const configuredHome = useExperimentStore((state) => state.configuration.homePosition);
  const selectedScene = useExperimentStore((state) => state.selectedScene);
  const progressId = useExperimentStore((state) => state.progressId);
  const savedView = useExperimentStore((state) => state.flightMapView);
  const setFlightMapView = useExperimentStore((state) => state.setFlightMapView);
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
  const home = validMapCoordinates(mapHome) ? mapHome : configuredHome ?? flightStatus.homePosition;
  const scenePosition = validMapCoordinates(mapHome) && validMapCoordinates(configuredHome)
    ? rebaseMapCoordinates(flightStatus.position, mapHome, configuredHome) : flightStatus.position;
  const sceneTrack = useMemo(() => validMapCoordinates(mapHome) && validMapCoordinates(configuredHome)
    ? flightPath.map(point => rebaseMapCoordinates(point, mapHome, configuredHome)) : flightPath, [flightPath, mapHome, configuredHome]);
  const sceneWaypoints = useMemo(() => validMapCoordinates(mapHome) && validMapCoordinates(configuredHome)
    ? plannedWaypoints.map(point => rebaseMapCoordinates(point, mapHome, configuredHome)) : plannedWaypoints, [plannedWaypoints, mapHome, configuredHome]);
  const telemetryReady = telemetryAvailability === 'AVAILABLE' && latest !== null
    && latest.mavlinkStatus.connected && latest.mavlinkStatus.heartbeat && validMapCoordinates(latest.position);
  const vehicleReady = telemetryReady && validMapCoordinates(mapHome);
  const basicTrainingComplete = trainingTasks.length > 0 && trainingTasks.every((task) => task.status === 'COMPLETED');

  if (!selectedScene || !validMapCoordinates(configuredHome)) {
    return <PanelShell title="飞行任务视图" icon={Crosshair} emphasis="primary"><p role="alert">缺少有效的场景 HOME，请返回步骤3确认训练场与起飞点。</p></PanelShell>;
  }

  return (
    <PanelShell
      title="飞行任务视图"
      icon={Crosshair}
      action={<span>二维地图 · 实时遥测轨迹</span>}
      emphasis="primary"
    >
      <FlightSceneViewport
        altitudeMeters={flightStatus.position.altitude}
        armed={flightStatus.armed}
        currentTask={activeTask?.title ?? '待命'}
        speedMetersPerSecond={flightStatus.groundSpeed}
        latitude={scenePosition.latitude}
        longitude={scenePosition.longitude}
        home={configuredHome}
        north={flightStatus.north}
        east={flightStatus.east}
        yaw={flightStatus.yaw}
        mode={flightStatus.mode}
        flightPath={sceneTrack}
        sceneContext={selectedScene && validMapCoordinates(configuredHome) ? {
          contextId: flightMapContextId(progressId, selectedScene.id, configuredHome),
          sceneName: selectedScene.name,
          coordinateMode: 'scene-relative',
          configuredHome,
          sceneCenter: { latitude: selectedScene.latitude, longitude: selectedScene.longitude },
          initialZoom: 17.2,
          actualHome: validMapCoordinates(mapHome) ? mapHome : null,
          telemetryReady: telemetryReady && validMapCoordinates(mapHome),
          savedView,
          onViewChange: setFlightMapView,
          mapError,
          onRetryMap: () => { void refreshMap(); },
        } : undefined}
        routePlanner={{
          visible: plannerOpen,
          editable: plannerPhase === 'PLANNING' || plannerPhase === 'ERROR',
          phase: plannerPhase,
          waypoints: sceneWaypoints,
          altitudeMeters: plannedAltitude,
          maxAltitudeMeters,
          vehicleReady,
          error: plannerError,
          onAddWaypoint: (latitude, longitude) => {
            if (!validMapCoordinates(mapHome)) return;
            const waypoint = rebaseMapCoordinates({ latitude, longitude }, configuredHome, mapHome);
            addWaypoint(waypoint.latitude, waypoint.longitude);
          },
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
