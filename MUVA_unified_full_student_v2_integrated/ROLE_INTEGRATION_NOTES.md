# MUVA role integration notes

This project is intentionally built from the user's original student frontend as the source of truth.

## Student frontend preserved
- Platform overview uses the original `DashboardPage` and its real Zustand/runtime data.
- Experiment Center and all five experiment routes are preserved.
- Experiment 1 (`BasicFlightPage` + `ExperimentLayout`) is preserved.
- Real-time flight control is preserved.
- Experiment records/detail, analytics, reports, telemetry/flight/experiment stores and APIs are preserved.
- New student-only additions: My Courses and My Grades.

## Roles added
- Admin: dashboard, users, permissions, courses, experiment definitions, simulation resources, logs, settings.
- Teacher: dashboard, courses, experiments, students, monitoring, grades, simulation demo.
- Student: original frontend + My Courses + My Grades.

## Auth / data sources
The login UI supports ADMIN / TEACHER / STUDENT. During frontend development it uses mock accounts by default.
Set `VITE_AUTH_DATA_SOURCE=api` later to use `/api/auth/login` and `/api/auth/me`.
Admin APIs are also reserved in `src/services/adminApi.ts`.
