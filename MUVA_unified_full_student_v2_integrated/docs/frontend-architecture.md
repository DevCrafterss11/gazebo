# MUVA Frontend Architecture

React pages and reusable components render state and dispatch user intent. Zustand stores coordinate workflow state and subscribe to service interfaces. `src/services/serviceRegistry.ts` is the composition root: it selects Mock or API implementations and exposes runtime capabilities.

The dependency direction is:

`Component -> Store/domain hook -> Service contract -> Mock or API adapter -> Gateway`

Mock implementations are deterministic and use `MockDroneSimulator` as the vehicle state authority. API implementations use HTTP REST for commands and WebSocket JSON for telemetry. Components must not import concrete services, issue network requests, or decode MAVLink.

Experiment records contain the session, result, task state, event timeline, and telemetry history so the training workflow remains independent of the transport.

