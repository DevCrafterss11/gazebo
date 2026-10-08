import type {
  DroneService,
  EnvironmentService,
  ExperimentService,
  FlightService,
  MissionService,
  SceneService,
  TelemetryService,
} from './contracts';
import {
  ApiDroneService,
  ApiEnvironmentService,
  ApiExperimentService,
  ApiFlightService,
  ApiMissionService,
  ApiSceneService,
  ApiTelemetryService,
} from './api/ApiServices';
import { MockDroneService } from './mock/MockDroneService';
import { MockEnvironmentService } from './mock/MockEnvironmentService';
import { MockExperimentService } from './mock/MockExperimentService';
import { MockFlightService } from './mock/MockFlightService';
import { MockMissionService } from './mock/MockMissionService';
import { MockSceneService } from './mock/MockSceneService';
import { MockTelemetryService } from './mock/MockTelemetryService';
import { MockSwarmRuntime } from './mock/MockSwarmRuntime';
import type { SwarmService } from './swarmContract';
import { assessmentRuntime, type AssessmentRuntime } from './mock/MockAssessmentRuntime';
import { MockDroneAdapter, RealMavlinkAdapter, assessmentSource, type AssessmentDroneAdapter } from './assessment/droneAdapter';

export type DataSource = 'mock' | 'api';

export interface RuntimeCapabilities {
  dataSource: DataSource;
  supportsRealtimeTelemetry: boolean;
  supportsFlightControl: boolean;
  supportsMission: boolean;
  supportsRecording: boolean;
}

const dataSource: DataSource = import.meta.env.VITE_DATA_SOURCE === 'api' ? 'api' : 'mock';

export interface ServiceRegistry {
  dataSource: DataSource;
  capabilities: RuntimeCapabilities;
  drones: DroneService;
  experiments: ExperimentService;
  environment: EnvironmentService;
  flight: FlightService;
  missions: MissionService;
  scenes: SceneService;
  telemetry: TelemetryService;
  swarm: SwarmService;
  assessment: AssessmentRuntime;
  assessmentAdapter: AssessmentDroneAdapter;
}

export const services: ServiceRegistry = dataSource === 'api'
  ? {
      dataSource,
      capabilities: { dataSource, supportsRealtimeTelemetry: true, supportsFlightControl: true, supportsMission: true, supportsRecording: true },
      drones: new ApiDroneService(),
      experiments: new ApiExperimentService(),
      environment: new ApiEnvironmentService(),
      flight: new ApiFlightService(),
      missions: new ApiMissionService(),
      scenes: new ApiSceneService(),
      telemetry: new ApiTelemetryService(),
      swarm: new MockSwarmRuntime(),
      assessment: assessmentRuntime,
      assessmentAdapter: assessmentSource === 'real' ? new RealMavlinkAdapter() : new MockDroneAdapter(assessmentRuntime),
    }
  : {
      dataSource,
      capabilities: { dataSource, supportsRealtimeTelemetry: true, supportsFlightControl: true, supportsMission: true, supportsRecording: true },
      drones: new MockDroneService(),
      experiments: new MockExperimentService(),
      environment: new MockEnvironmentService(),
      flight: new MockFlightService(),
      missions: new MockMissionService(),
      scenes: new MockSceneService(),
      telemetry: new MockTelemetryService(),
      swarm: new MockSwarmRuntime(),
      assessment: assessmentRuntime,
      assessmentAdapter: assessmentSource === 'real' ? new RealMavlinkAdapter() : new MockDroneAdapter(assessmentRuntime),
    };
