import type {
  AttitudePayload,
  BatteryPayload,
  EstimatorStatusPayload,
  FlightStatePayload,
  GpsPayload,
  HeartbeatPayload,
  PositionPayload,
  SnapshotPayload,
  TelemetryMessageEnvelope,
  TelemetryPayload,
  TelemetrySource,
} from '../../types/telemetry';

type UnknownRecord = Record<string, unknown>;

export class TelemetryValidationError extends Error {
  constructor(message: string) {
    super(`Invalid telemetry message: ${message}`);
    this.name = 'TelemetryValidationError';
  }
}

export function parseTelemetryEnvelope(value: unknown): TelemetryMessageEnvelope {
  if (!isRecord(value)) throw new TelemetryValidationError('message must be an object');
  if (value.protocolVersion !== '1.0') throw new TelemetryValidationError('unsupported protocolVersion');
  if (value.type !== 'telemetry') throw new TelemetryValidationError('type must be telemetry');
  if (!isFiniteNumber(value.timestamp)) throw new TelemetryValidationError('timestamp must be finite');
  if (typeof value.vehicleId !== 'string' || value.vehicleId.length === 0) throw new TelemetryValidationError('vehicleId is required');
  if (!isFiniteNumber(value.sequence) || !Number.isInteger(value.sequence) || value.sequence < 0) throw new TelemetryValidationError('sequence must be a non-negative integer');
  if (!isSource(value.source)) throw new TelemetryValidationError('source is invalid');
  if (!isTelemetryPayload(value.payload)) throw new TelemetryValidationError('payload is invalid');

  return {
    protocolVersion: '1.0',
    type: 'telemetry',
    timestamp: value.timestamp,
    vehicleId: value.vehicleId,
    sequence: value.sequence,
    source: value.source,
    payload: value.payload,
  };
}

export function isTelemetryPayload(value: unknown): value is TelemetryPayload {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'SNAPSHOT': return isSnapshotPayload(value);
    case 'HEARTBEAT': return typeof value.armed === 'boolean' && typeof value.mode === 'string' && (value.version === undefined || typeof value.version === 'string');
    case 'ESTIMATOR_STATUS': return typeof value.healthy === 'boolean' && typeof value.state === 'string';
    case 'POSITION': return isFiniteNumber(value.latitude) && isFiniteNumber(value.longitude) && isFiniteNumber(value.altitude)
      && (value.north === undefined || isFiniteNumber(value.north))
      && (value.east === undefined || isFiniteNumber(value.east))
      && (value.groundSpeed === undefined || isFiniteNumber(value.groundSpeed));
    case 'ATTITUDE': return isFiniteNumber(value.roll) && isFiniteNumber(value.pitch) && isFiniteNumber(value.yaw);
    case 'GPS': return isFiniteNumber(value.satellites) && typeof value.fixType === 'string' && isFiniteNumber(value.hdop);
    case 'BATTERY': return isFiniteNumber(value.percent) && value.percent >= 0 && value.percent <= 100;
    case 'FLIGHT_STATE': return typeof value.state === 'string';
    default: return false;
  }
}

const isSnapshotPayload = (input: unknown): input is SnapshotPayload => {
  if (!isRecord(input)) return false;
  return isPosition(input.position)
    && isVelocity(input.velocity)
    && isAttitude(input.attitude)
    && isFiniteNumber(input.batteryPercent) && input.batteryPercent >= 0 && input.batteryPercent <= 100
    && isGps(input.gps)
    && isRecord(input.health) && isEkfStatus(input.health.ekfStatus) && isMavlinkStatus(input.health.mavlinkStatus)
    && isRecord(input.system) && typeof input.system.mode === 'string' && typeof input.system.armed === 'boolean';
};

const isPosition = (value: unknown): value is SnapshotPayload['position'] => {
  if (!isRecord(value)) return false;
  return isFiniteNumber(value.latitude) && isFiniteNumber(value.longitude) && isFiniteNumber(value.altitude);
};
const isVelocity = (value: unknown): value is SnapshotPayload['velocity'] => isRecord(value)
  && isFiniteNumber(value.groundSpeed) && isFiniteNumber(value.verticalSpeed);
const isAttitude = (value: unknown): value is AttitudePayload => isRecord(value)
  && isFiniteNumber(value.roll) && isFiniteNumber(value.pitch) && isFiniteNumber(value.yaw);
const isGps = (value: unknown): value is GpsPayload => isRecord(value)
  && isFiniteNumber(value.satellites) && typeof value.fixType === 'string' && isFiniteNumber(value.hdop);
const isEkfStatus = (value: unknown): value is SnapshotPayload['health']['ekfStatus'] => isRecord(value)
  && typeof value.healthy === 'boolean' && typeof value.state === 'string';
const isMavlinkStatus = (value: unknown): value is SnapshotPayload['health']['mavlinkStatus'] => isRecord(value)
  && typeof value.connected === 'boolean' && typeof value.heartbeat === 'boolean' && typeof value.version === 'string';
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isRecord = (value: unknown): value is UnknownRecord => typeof value === 'object' && value !== null;
const isSource = (value: unknown): value is TelemetrySource => value === 'mavlink' || value === 'simulation' || value === 'gateway';

export type {
  AttitudePayload,
  BatteryPayload,
  EstimatorStatusPayload,
  FlightStatePayload,
  GpsPayload,
  HeartbeatPayload,
  PositionPayload,
};
