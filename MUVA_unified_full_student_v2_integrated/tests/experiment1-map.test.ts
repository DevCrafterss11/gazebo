import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';

import { flightMapContextId, homeDistanceMeters, initialFlightMapView, mergeFlightMapTrack, offscreenVehicleIndicator, rebaseMapCoordinates, segmentFlightMapTrack, validFlightMapView } from '../src/domain/flightMap';
import { createDefaultConfiguration, mockScenes } from '../src/mocks/configuration';
import { mockDroneModels } from '../src/mocks/flight';
import { mockExperiment } from '../src/mocks/experiment';
import { services } from '../src/services/serviceRegistry';
import type { TelemetryConnectionHandler, TelemetryHandler, TelemetryService } from '../src/services/contracts';
import { ApiTelemetryService } from '../src/services/api/ApiServices';
import { httpClient } from '../src/services/http/client';
import { MockExperimentService } from '../src/services/mock/MockExperimentService';
import { MockTelemetryService } from '../src/services/mock/MockTelemetryService';
import { mockDroneSimulator } from '../src/services/mock/MockDroneSimulator';
import { useExperimentStore } from '../src/stores/experimentStore';
import { useEnvironmentStore } from '../src/stores/environmentStore';
import { useRoutePlannerStore } from '../src/stores/routePlannerStore';
import { useTelemetryStore } from '../src/stores/telemetryStore';
import type { FlightMapSnapshot, FlightPathPoint, TelemetrySample } from '../src/types/telemetry';

test('scene display maps the simulator HOME to selected HOME without changing raw telemetry', () => {
  const actualHome = { latitude: 34.125159, longitude: 108.828965 };
  const sceneHome = { latitude: 37.75, longitude: -119.58 };
  const actualPosition = { ...actualHome, altitude: 0, timestamp: 1000 };
  const original = { ...actualPosition };
  const displayed = rebaseMapCoordinates(actualPosition, actualHome, sceneHome);
  assert.ok(homeDistanceMeters(displayed, sceneHome) < 0.001);
  assert.deepEqual(actualPosition, original);
  assert.equal(displayed.timestamp, 1000);
  assert.equal(displayed.altitude, 0);
});

test('scene display preserves north/east displacement and reverses clicked waypoints to actual flight coordinates', () => {
  const actualHome = { latitude: 34.125159, longitude: 108.828965 };
  const sceneHome = { latitude: 37.75, longitude: -119.58 };
  const point = { latitude: actualHome.latitude + 20 / 111_111,
    longitude: actualHome.longitude + 15 / (111_111 * Math.cos(actualHome.latitude * Math.PI / 180)), altitude: 10 };
  const displayed = rebaseMapCoordinates(point, actualHome, sceneHome);
  assert.ok(Math.abs((displayed.latitude - sceneHome.latitude) * 111_111 - 20) < 0.001);
  assert.ok(Math.abs((displayed.longitude - sceneHome.longitude) * 111_111 * Math.cos(sceneHome.latitude * Math.PI / 180) - 15) < 0.001);
  const command = rebaseMapCoordinates(displayed, sceneHome, actualHome);
  assert.ok(homeDistanceMeters(command, point) < 0.001);
  assert.equal(command.altitude, 10);
});

test('offscreen vehicle indicator stays inside the map and points toward the real projected position', () => {
  assert.equal(offscreenVehicleIndicator({ x: 400, y: 200 }, 800, 400), null);
  assert.deepEqual(offscreenVehicleIndicator({ x: 10000, y: 200 }, 800, 400), { x: 712, y: 200, bearing: 90 });
  assert.deepEqual(offscreenVehicleIndicator({ x: -10000, y: 200 }, 800, 400), { x: 88, y: 200, bearing: -90 });
  assert.deepEqual(offscreenVehicleIndicator({ x: 400, y: -10000 }, 800, 400), { x: 400, y: 70, bearing: 0 });
  assert.deepEqual(offscreenVehicleIndicator({ x: 400, y: 10000 }, 800, 400), { x: 400, y: 330, bearing: 180 });
  const position = { x: 1000000, y: -1000000 };
  const indicator = offscreenVehicleIndicator(position, 800, 400);
  assert.ok(indicator && indicator.x >= 88 && indicator.x <= 712 && indicator.y >= 70 && indicator.y <= 330);
  assert.deepEqual(position, { x: 1000000, y: -1000000 });
});

test('offscreen indicator handles small layouts and ignores invalid projections', () => {
  const indicator = offscreenVehicleIndicator({ x: 1000, y: 1000 }, 120, 100);
  assert.ok(indicator && indicator.x >= 30 && indicator.x <= 90 && indicator.y >= 25 && indicator.y <= 75);
  assert.equal(offscreenVehicleIndicator({ x: NaN, y: 200 }, 800, 400), null);
  assert.equal(offscreenVehicleIndicator({ x: 1000, y: Infinity }, 800, 400), null);
  assert.equal(offscreenVehicleIndicator({ x: 1000, y: 200 }, 0, 400), null);
  assert.equal(offscreenVehicleIndicator({ x: 1000, y: 200 }, 800, -1), null);
});

const storage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
  };
};

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
};

const home = { latitude: 34.1251589, longitude: 108.8289653, altitude: 412 };
const point = (timestamp: number, north = 0): FlightPathPoint => ({ ...home, timestamp, north, east: 0, latitude: home.latitude + north / 111111 });
const sample = (timestamp: number, north = 0): TelemetrySample => ({
  timestamp, position: point(timestamp, north), attitude: { roll: 0, pitch: 0, yaw: 0 },
  speedMetersPerSecond: 1, batteryPercent: 100, gpsSatellites: 16,
  ekfStatus: { healthy: true, state: 'HEALTHY' }, mavlinkStatus: { connected: true, heartbeat: true, version: '2.0' }, north, east: 0,
});

class ControlledTelemetry implements TelemetryService {
  handlers = new Set<TelemetryHandler>();
  connections = new Set<TelemetryConnectionHandler>();
  snapshots = [] as ReturnType<typeof deferred<FlightMapSnapshot>>[];
  connected = false;
  async getFlightMap() {
    const request = deferred<FlightMapSnapshot>();
    this.snapshots.push(request);
    return request.promise;
  }
  subscribe(handler: TelemetryHandler) { this.handlers.add(handler); return () => { this.handlers.delete(handler); }; }
  subscribeToConnectionState(handler: TelemetryConnectionHandler) {
    this.connections.add(handler);
    handler(this.connected ? 'connected' : 'idle');
    return () => { this.connections.delete(handler); };
  }
  connect() { this.connected = true; this.connections.forEach((handler) => handler('connected')); }
  disconnect() { this.connected = false; this.connections.forEach((handler) => handler('disconnected')); }
  emit(value: TelemetrySample) { this.handlers.forEach((handler) => handler(value)); }
}

const originalTelemetry = services.telemetry;
let controlled: ControlledTelemetry;

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage() });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage() });
  useTelemetryStore.getState().disconnect();
  useTelemetryStore.getState().clear();
  useRoutePlannerStore.getState().cancel();
  controlled = new ControlledTelemetry();
  services.telemetry = controlled;
});

afterEach(() => {
  useTelemetryStore.getState().disconnect();
  useTelemetryStore.getState().clear();
  services.telemetry = originalTelemetry;
  mockDroneSimulator.stop();
});

test('four scenes initially center on their configured HOME, never on the previous scene', () => {
  for (const scene of mockScenes.filter((item) => ['campus', 'city', 'mountain', 'airport'].includes(item.id))) {
    const contextId = flightMapContextId('run-one', scene.id, scene);
    const initial = initialFlightMapView(contextId, scene, null);
    assert.deepEqual(initial.center, { latitude: scene.latitude, longitude: scene.longitude });
    assert.equal(initial.zoom, 18);
    assert.equal(initial.contextId, contextId);
  }
});

test('same run keeps user pan and zoom while changed HOME, scene and run invalidate old camera', () => {
  const contextId = flightMapContextId('run-one', 'campus', home);
  const saved = { contextId, center: { latitude: 34.126, longitude: 108.829 }, zoom: 17 };
  assert.deepEqual(initialFlightMapView(contextId, home, saved), saved);
  for (const nextContext of [flightMapContextId('run-two', 'campus', home), flightMapContextId('run-one', 'city', home), flightMapContextId('run-one', 'campus', { ...home, latitude: 34.12 })]) {
    assert.equal(initialFlightMapView(nextContext, home, saved).zoom, 18);
    assert.deepEqual(initialFlightMapView(nextContext, home, saved).center, { latitude: home.latitude, longitude: home.longitude });
  }
  assert.equal(validFlightMapView({ ...saved, zoom: Number.NaN }), false);
  assert.equal(validFlightMapView({ ...saved, center: { latitude: 91, longitude: 0 } }), false);
});

test('HOME distance detects mismatch without modifying coordinates, including antimeridian', () => {
  const actual = { ...home, latitude: home.latitude + 0.0001 };
  assert.ok(homeDistanceMeters(home, actual) > 10 && homeDistanceMeters(home, actual) < 12);
  assert.equal(homeDistanceMeters(home, home), 0);
  assert.equal(actual.latitude, home.latitude + 0.0001);
  assert.ok(homeDistanceMeters({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 }) < 230);
});

test('snapshot merge excludes earlier sessions and missing timestamps, sorts and deduplicates live points', () => {
  const result = mergeFlightMapTrack([point(90), point(120), { ...point(130), timestamp: undefined }], [point(110, 1), point(120)], 100);
  assert.deepEqual(result.map((item) => item.timestamp), [110, 120]);
  assert.equal(mergeFlightMapTrack([], [{ ...point(120), latitude: Number.NaN }], 100).length, 0);
});

test('display track breaks long telemetry gaps and impossible jumps without deleting points', () => {
  const raw = [point(1_000), point(2_000, 4), point(10_000, 5), point(11_000, 80)];
  const segments = segmentFlightMapTrack(raw);

  assert.deepEqual(segments.map((segment) => segment.map((item) => item.timestamp)), [[1_000, 2_000], [10_000]]);
  assert.equal(segments.flat().length, raw.length - 1);
  assert.deepEqual(raw.map((item) => item.north), [0, 4, 5, 80]);
});

test('API map adapter converts Gateway track timestamps from seconds to milliseconds', async () => {
  const adapter = httpClient.defaults.adapter;
  httpClient.defaults.adapter = async (config) => ({ data: { home: { ...home, valid: true }, track: [{ ...home, timestamp: 1_791_590_400 }] }, status: 200, statusText: 'OK', headers: {}, config });
  try {
    const snapshot = await new ApiTelemetryService().getFlightMap();
    assert.equal(snapshot.track[0]?.timestamp, 1_791_590_400_000);
    assert.deepEqual(snapshot.home, home);
  } finally { httpClient.defaults.adapter = adapter; }
});

test('Mock map HOME is read from the single simulator rather than a default campus location', async () => {
  const city = mockScenes.find((scene) => scene.id === 'city')!;
  mockDroneSimulator.initialize(city);
  const snapshot = await new MockTelemetryService().getFlightMap();
  assert.equal(snapshot.home?.latitude, city.latitude);
  assert.equal(snapshot.home?.longitude, city.longitude);
});

test('late map responses and subscription callbacks cannot write into a new Session', async () => {
  const store = useTelemetryStore.getState();
  store.setMapContext('session-one', 100);
  store.connect();
  const oldRequests = [...controlled.snapshots];
  const oldCallback = [...controlled.handlers][0]!;
  store.setMapContext('session-two', 200);
  oldCallback(sample(210));
  assert.equal(useTelemetryStore.getState().latest, null);
  for (const request of oldRequests) request.resolve({ home, track: [point(150)] });
  await flush();
  assert.equal(useTelemetryStore.getState().mapHome, null);
  assert.deepEqual(useTelemetryStore.getState().flightPath, []);
  store.connect();
  controlled.emit(sample(199));
  assert.equal(useTelemetryStore.getState().latest, null);
  controlled.emit(sample(210, 1));
  controlled.snapshots.at(-1)!.resolve({ home, track: [point(190), point(205)] });
  await flush();
  assert.deepEqual(useTelemetryStore.getState().flightPath.map((item) => item.timestamp), [205, 210]);
});

test('clearing progress invalidates pending map responses; active map errors surface and can be retried', async () => {
  const store = useTelemetryStore.getState();
  const first = store.refreshMap();
  store.clear();
  controlled.snapshots.at(-1)!.resolve({ home, track: [] });
  await first;
  assert.equal(useTelemetryStore.getState().mapHome, null);
  const failed = store.refreshMap();
  controlled.snapshots.at(-1)!.reject(new Error('offline'));
  await failed;
  assert.match(useTelemetryStore.getState().mapError ?? '', /offline/);
  const retry = store.refreshMap();
  controlled.snapshots.at(-1)!.resolve({ home, track: [] });
  await retry;
  assert.equal(useTelemetryStore.getState().mapError, null);
  assert.deepEqual(useTelemetryStore.getState().mapHome, home);
});

test('invalid timestamps and disconnected or heartbeatless samples cannot create a flight track', () => {
  const store = useTelemetryStore.getState();
  store.setMapContext('current-session', 100);
  store.connect();
  controlled.emit({ ...sample(Number.NaN, 1) });
  controlled.emit({ ...sample(Number.POSITIVE_INFINITY, 1) });
  assert.equal(useTelemetryStore.getState().latest, null);
  controlled.emit({ ...sample(110, 1), mavlinkStatus: { connected: false, heartbeat: false, version: '2.0' } });
  controlled.emit({ ...sample(120, 2), mavlinkStatus: { connected: true, heartbeat: false, version: '2.0' } });
  controlled.emit({ ...sample(130, 3), position: { ...home, latitude: Number.NaN } });
  assert.deepEqual(useTelemetryStore.getState().flightPath, []);
  controlled.emit(sample(140, 4));
  assert.deepEqual(useTelemetryStore.getState().flightPath.map((item) => item.timestamp), [140]);
});

test('route return preserves live track; reconnect refreshes HOME without duplicating track', async () => {
  const store = useTelemetryStore.getState();
  store.setMapContext('same-session', 100);
  store.connect();
  controlled.emit(sample(110, 1));
  store.connect();
  assert.equal(controlled.handlers.size, 1);
  assert.equal(useTelemetryStore.getState().flightPath.length, 1);
  const requests = controlled.snapshots.length;
  store.disconnect();
  assert.equal(useTelemetryStore.getState().latest, null);
  assert.equal(useTelemetryStore.getState().flightPath.length, 1);
  store.connect();
  assert.ok(controlled.snapshots.length > requests);
  controlled.snapshots.at(-1)!.resolve({ home, track: [point(110, 1)] });
  await flush();
  assert.equal(useTelemetryStore.getState().flightPath.length, 1);
});

test('map camera survives Mock progress serialization but no realtime connection is persisted', async () => {
  const contextId = flightMapContextId('progress', 'campus', home);
  const flightMapView = { contextId, center: { latitude: 34.126, longitude: 108.829 }, zoom: 16 };
  const service = new MockExperimentService();
  await service.saveConfiguration({ version: 2, progressId: 'progress', currentStep: 7, completedSteps: [1, 2, 3, 4, 5, 6], configuration: createDefaultConfiguration(), flightMapView });
  assert.deepEqual((await new MockExperimentService().loadConfiguration())?.flightMapView, flightMapView);
  assert.equal(useTelemetryStore.getState().availability, 'UNKNOWN');
});

test('scene changes and HOME edits reset the camera, track and route without rebuilding eight steps', () => {
  useExperimentStore.setState({ scenes: mockScenes, progressId: 'progress', configuration: createDefaultConfiguration(), simulationStarted: false });
  const store = useExperimentStore.getState();
  store.selectScene('campus');
  const selectedHome = useExperimentStore.getState().configuration.homePosition!;
  const view = { contextId: flightMapContextId('progress', 'campus', selectedHome), center: home, zoom: 17 };
  store.setFlightMapView(view);
  useTelemetryStore.setState({ flightPath: [point(110)], mapHome: home });
  const planner = useRoutePlannerStore.getState();
  planner.open(10); planner.addWaypoint(home.latitude, home.longitude);
  store.updateHomePosition('longitude', home.longitude + 0.001);
  assert.equal(useExperimentStore.getState().flightMapView, null);
  assert.deepEqual(useTelemetryStore.getState().flightPath, []);
  assert.deepEqual(useRoutePlannerStore.getState().waypoints, []);
  store.setFlightMapView(view);
  assert.equal(useExperimentStore.getState().flightMapView, null);
  store.selectScene('city');
  assert.equal(useExperimentStore.getState().selectedScene?.id, 'city');
  assert.equal(useExperimentStore.getState().experiment.steps.length, 8);
});

test('restarting clears the map and Session, then step four creates a distinct environment Session', async () => {
  const previousStop = useEnvironmentStore.getState().stop;
  const previousEnvironment = useEnvironmentStore.getState().startup;
  const configuration = { ...createDefaultConfiguration(), selectedDroneId: mockDroneModels[0]!.id, selectedSceneId: 'campus', homePosition: home };
  const session = await services.experiments.createExperiment({ name: '实验一', drone: mockDroneModels[0]!, scene: mockScenes[0]!, configuration });
  useExperimentStore.setState({ configuration, sessionId: session.id, session, progressId: 'old-progress', flightMapView: { contextId: 'old-view', center: home, zoom: 17 } });
  useTelemetryStore.setState({ flightPath: [point(110)], mapHome: home });
  useRoutePlannerStore.getState().open(10);
  useRoutePlannerStore.getState().addWaypoint(home.latitude, home.longitude);
  useEnvironmentStore.setState({ stop: async () => { useTelemetryStore.getState().disconnect(); } });
  try {
    await useExperimentStore.getState().restartExperiment();
    assert.equal(useExperimentStore.getState().experiment.currentStep, 1);
    assert.notEqual(useExperimentStore.getState().progressId, 'old-progress');
    assert.equal(useExperimentStore.getState().sessionId, null);
    assert.equal(useExperimentStore.getState().flightMapView, null);
    assert.deepEqual(useTelemetryStore.getState().flightPath, []);
    assert.deepEqual(useRoutePlannerStore.getState().waypoints, []);
    useExperimentStore.setState({ configuration, selectedDrone: mockDroneModels[0]!, selectedScene: mockScenes[0]!, experiment: { ...mockExperiment, currentStep: 4 } });
    useEnvironmentStore.setState({ startup: { phase: 'READY', progress: 100, message: 'test ready' } });
    await useExperimentStore.getState().startSimulation();
    assert.ok(useExperimentStore.getState().sessionId);
    assert.notEqual(useExperimentStore.getState().sessionId, session.id);
    assert.equal(useTelemetryStore.getState().mapContextId, useExperimentStore.getState().sessionId);
  } finally { useEnvironmentStore.setState({ stop: previousStop, startup: previousEnvironment }); }
});

test('discarded route upload cannot arm or start a mission in a new map context', async () => {
  const originalUpload = services.missions.uploadMission;
  const originalArm = services.flight.arm;
  const originalStart = services.missions.startMission;
  const upload = deferred<Awaited<ReturnType<typeof originalUpload>>>();
  const commands: string[] = [];
  services.missions.uploadMission = () => upload.promise;
  services.flight.arm = async () => { commands.push('arm'); };
  services.missions.startMission = async () => { commands.push('start'); };
  try {
    const planner = useRoutePlannerStore.getState();
    planner.open(10); planner.addWaypoint(home.latitude, home.longitude);
    const execution = planner.execute({ home, armed: false, vehicleReady: true, basicTrainingComplete: true });
    planner.cancel();
    upload.reject(new Error('old upload failed'));
    await execution;
    assert.deepEqual(commands, []);
    assert.equal(useRoutePlannerStore.getState().phase, 'IDLE');
    assert.equal(useRoutePlannerStore.getState().error, null);
  } finally { services.missions.uploadMission = originalUpload; services.flight.arm = originalArm; services.missions.startMission = originalStart; }
});
