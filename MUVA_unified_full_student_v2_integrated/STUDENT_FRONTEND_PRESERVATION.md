# Student frontend preservation check

The student side is based directly on the user-uploaded original project `gazebo 2(1).zip`.

The following core files were checksum-compared after integration and are unchanged from the uploaded frontend:

- src/pages/platform/DashboardPage.tsx
- src/pages/experiments/ExperimentsPage.tsx
- src/pages/experiments/basic-flight/BasicFlightPage.tsx
- src/pages/platform/FlightPage.tsx
- src/pages/platform/RecordsPage.tsx
- src/pages/platform/RecordDetailPage.tsx
- src/pages/platform/AnalyticsPage.tsx
- src/pages/platform/ReportsPage.tsx
- src/stores/experimentStore.ts
- src/stores/flightStore.ts
- src/stores/telemetryStore.ts
- src/services/experimentApi.ts
- src/services/flightApi.ts
- src/services/telemetryApi.ts

Student navigation now consists of the original functional frontend plus two additive teaching-platform pages:

- Platform Overview (original)
- My Courses (new, mock/API-reserved)
- Experiment Center (original)
  - Experiment 1 Basic Flight (original)
  - Experiment 2 Swarm Flight Control (original placeholder)
  - Experiment 3 Mission Collaboration (original placeholder)
  - Experiment 4 Security Confrontation (original placeholder)
  - Experiment 5 Custom Security Confrontation (original placeholder)
- Real-time Flight Control (original)
- Experiment Records (original)
- Data Analytics (original)
- Experiment Reports (original)
- My Grades (new, mock/API-reserved)
- Help (original)

Role integration intentionally removes the old student-visible Teaching Management and System Settings entries because those capabilities now belong to Teacher/Admin roles.
