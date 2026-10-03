# Backend Integration Boundary

The future backend may run ArduPilot SITL and Gazebo behind a FastAPI/MAVLink Gateway. The frontend boundary remains the existing service contracts: environment lifecycle, flight commands, telemetry subscription, mission operations, and experiment persistence.

The Gateway owns process lifecycle, MAVLink transport, decoding, vehicle identity, command acknowledgement, and reconnect semantics. The browser consumes versioned JSON DTOs documented in `telemetry-protocol.md` and does not handle MAVLink binary data.

To integrate the backend, implement the API service classes behind the existing contracts, configure `VITE_DATA_SOURCE=api`, and preserve the same domain semantics and error states as Mock services. No page-level rewrite should be required.
