# MUVA Telemetry Protocol

Version: `1.0`

The browser receives JSON from the MAVLink Gateway over WebSocket. It never decodes MAVLink frames.

## Message Envelope

Telemetry uses a single versioned envelope. The outer `type` is always `telemetry`; the MAVLink-derived message kind is carried by `payload.type`.

```json
{
  "protocolVersion": "1.0",
  "type": "telemetry",
  "timestamp": 1710000000000,
  "vehicleId": "iris-001",
  "sequence": 42,
  "source": "mavlink",
  "payload": {
    "type": "HEARTBEAT",
    "armed": false,
    "mode": "GUIDED",
    "version": "MAVLink 2"
  }
}
```

Required envelope fields are validated before a message reaches the Store. `timestamp` is Unix milliseconds, `sequence` is a non-negative integer monotonically increasing per vehicle, and `source` is one of `mavlink`, `simulation`, or `gateway`. Required numeric fields must be finite JSON numbers; `null`, `undefined`, `NaN`, and infinities are invalid.

## Payload Types

- `SNAPSHOT`: complete `position`, `velocity`, `attitude`, `batteryPercent`, `gps`, `health`, and `system` state.
- `HEARTBEAT`: `armed`, `mode`, and optional MAVLink `version`.
- `ESTIMATOR_STATUS`: EKF `healthy` and `state`.
- `POSITION`: latitude, longitude, altitude, and optional local offsets/speed.
- `ATTITUDE`: roll, pitch, yaw.
- `GPS`: satellites, fix type, and HDOP.
- `BATTERY`: battery percentage from 0 to 100.
- `FLIGHT_STATE`: simulator/vehicle flight state.

Unknown payload types and malformed payloads are rejected and logged by the browser transport. Event, runtime-status, and command-ack messages use separate future contracts and must not be sent as telemetry envelopes.

## MAVLink Mapping

`HEARTBEAT` maps to `system.armed`, `system.mode`, and `health.mavlinkStatus`. `ESTIMATOR_STATUS` maps to `health.ekfStatus`. Position, attitude, GPS, and battery MAVLink messages map to their corresponding snapshot sections.
