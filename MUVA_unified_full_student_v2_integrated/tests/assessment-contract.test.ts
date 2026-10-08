import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseTelemetryEnvelope } from '../src/services/websocket/telemetrySchema';
import { isRealTelemetryReady, toLocalPoint, toThreeEuler } from '../src/services/assessment/coordinates';
import { RealMavlinkAdapter } from '../src/services/assessment/droneAdapter';
import type { TelemetrySample } from '../src/types/telemetry';

const fixture = JSON.parse(readFileSync('tests/fixtures/gateway-snapshot.json', 'utf8')) as unknown;
test('actual gateway state fixture parses without adding invented fields', () => {
  const envelope = parseTelemetryEnvelope(fixture);
  assert.equal(envelope.source, 'mavlink');
  assert.equal(envelope.payload.type, 'SNAPSHOT');
  if (envelope.payload.type === 'SNAPSHOT') {
    assert.equal(envelope.payload.position.altitude, 18.4);
    assert.equal(envelope.payload.system.armed, true);
    assert.equal(envelope.payload.gps.satellites, 17);
  }
});
test('north/east map to web X-east Y-up Z-south, reject unknown home', () => {
  const sample: TelemetrySample = {
    timestamp: 1791460392951, snapshotTimestamp: 1791460392951, source: 'mavlink', position: { latitude: 34.34169, longitude: 108.939908, altitude: 18.4 },
    attitude: { roll: 0, pitch: 0, yaw: 0 }, speedMetersPerSecond: 5, batteryPercent: 76,
    gpsSatellites: 17, ekfStatus: { healthy: true, state: 'NORMAL' }, mavlinkStatus: { connected: true, heartbeat: true, version: 'MAVLink 2' },
  };
  const home = { latitude: 34.3416, longitude: 108.9398, altitude: 423.4 };
  assert.equal(toLocalPoint(sample, null), null);
  const position = toLocalPoint(sample, home);
  assert.ok(position && Math.abs(position.x - 9.9) < 0.2);
  assert.ok(position && Math.abs(position.z + 10) < 0.1);
  assert.equal(position?.y, 18.4);
  assert.equal(isRealTelemetryReady(sample, sample.timestamp + 1000), true);
  assert.equal(isRealTelemetryReady(sample, sample.timestamp + 4000), false);
  assert.equal(isRealTelemetryReady({ ...sample, timestamp: sample.timestamp + 4000 }, sample.timestamp + 4000), false);
  assert.equal(isRealTelemetryReady({ ...sample, snapshotTimestamp: undefined }, sample.timestamp), false);
  assert.equal(isRealTelemetryReady({ ...sample, source: 'simulation' }, sample.timestamp), false);
});
test('heading crossing north preserves clockwise orientation; real adapter never sends commands', async () => {
  assert.ok(Math.abs(toThreeEuler({ roll: 0, pitch: 0, yaw: 359 })[1] + 359 * Math.PI / 180) < 0.001);
  assert.ok(Math.abs(toThreeEuler({ roll: 10, pitch: -5, yaw: 90 })[2] + 10 * Math.PI / 180) < 0.001);
  await assert.rejects(new RealMavlinkAdapter().send('arm'), /只读真实观测/);
});
