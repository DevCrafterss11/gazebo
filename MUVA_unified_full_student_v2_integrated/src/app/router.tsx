import type { ReactNode } from 'react';
import { createBrowserRouter } from 'react-router-dom';

import { ExperimentLayout } from '../layouts/ExperimentLayout/ExperimentLayout';
import { MainLayout } from '../layouts/MainLayout/MainLayout';
import { ProtectedLayout } from '../layouts/MainLayout/ProtectedLayout';
import { RoleGuard, RoleHomeRedirect } from '../layouts/MainLayout/RoleGuard';
import { AdminCoursesPage } from '../pages/admin/AdminCoursesPage';
import { AdminDashboardPage } from '../pages/admin/AdminDashboardPage';
import { AdminExperimentsPage } from '../pages/admin/AdminExperimentsPage';
import { AdminLogsPage } from '../pages/admin/AdminLogsPage';
import { AdminPermissionsPage } from '../pages/admin/AdminPermissionsPage';
import { AdminResourcesPage } from '../pages/admin/AdminResourcesPage';
import { AdminSettingsPage } from '../pages/admin/AdminSettingsPage';
import { AdminUsersPage } from '../pages/admin/AdminUsersPage';
import { BasicFlightPage } from '../pages/experiments/basic-flight/BasicFlightPage';
import { ExperimentComingSoonPage } from '../pages/experiments/ExperimentComingSoonPage';
import { SwarmExperimentPage } from '../pages/experiments/swarm/SwarmExperimentPage';
import { SwarmRecordPage } from '../pages/experiments/swarm/SwarmRecordPage';
import { ExperimentsPage } from '../pages/experiments/ExperimentsPage';
import { AssessmentPage } from '../pages/experiments/assessment/AssessmentPage';
import { AssessmentRecordPage } from '../pages/experiments/assessment/AssessmentRecordPage';
import { RealAssessmentPage } from '../pages/experiments/assessment/RealAssessmentPage';
import { assessmentSource } from '../services/assessment/droneAdapter';
import { AnalyticsPage } from '../pages/platform/AnalyticsPage';
import { DashboardPage } from '../pages/platform/DashboardPage';
import { FlightPage } from '../pages/platform/FlightPage';
import { HelpPage } from '../pages/platform/HelpPage';
import { LoginPage } from '../pages/platform/LoginPage';
import { NotFoundPage } from '../pages/platform/NotFoundPage';
import { ProfilePage } from '../pages/platform/ProfilePage';
import { RecordDetailPage } from '../pages/platform/RecordDetailPage';
import { RecordsPage } from '../pages/platform/RecordsPage';
import { ReportsPage } from '../pages/platform/ReportsPage';
import { StudentCoursesPage } from '../pages/student/StudentCoursesPage';
import { StudentGradesPage } from '../pages/student/StudentGradesPage';
import { TeacherCoursesPage } from '../pages/teacher/TeacherCoursesPage';
import { TeacherDashboardPage } from '../pages/teacher/TeacherDashboardPage';
import { TeacherExperimentsPage } from '../pages/teacher/TeacherExperimentsPage';
import { TeacherGradesPage } from '../pages/teacher/TeacherGradesPage';
import { TeacherMonitorPage } from '../pages/teacher/TeacherMonitorPage';
import { TeacherStudentsPage } from '../pages/teacher/TeacherStudentsPage';

const studentOnly = (node: ReactNode) => <RoleGuard allowed={['student']}>{node}</RoleGuard>;
const teacherOnly = (node: ReactNode) => <RoleGuard allowed={['teacher']}>{node}</RoleGuard>;
const adminOnly = (node: ReactNode) => <RoleGuard allowed={['admin']}>{node}</RoleGuard>;
const teacherOrStudent = (node: ReactNode) => <RoleGuard allowed={['teacher', 'student']}>{node}</RoleGuard>;
const allRoles = (node: ReactNode) => <RoleGuard allowed={['admin', 'teacher', 'student']}>{node}</RoleGuard>;

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <ProtectedLayout />,
    children: [
      {
        element: <MainLayout />,
        children: [
          { index: true, element: <RoleHomeRedirect /> },

          // Student: the user's original frontend remains the source of truth.
          { path: 'dashboard', element: studentOnly(<DashboardPage />) },
          { path: 'courses', element: studentOnly(<StudentCoursesPage />) },
          { path: 'grades', element: studentOnly(<StudentGradesPage />) },
          { path: 'experiments', element: studentOnly(<ExperimentsPage />) },
          {
            path: 'experiments/basic-flight',
            element: studentOnly(<ExperimentLayout />),
            children: [{ index: true, element: <BasicFlightPage /> }],
          },
          { path: 'experiments/swarm', element: studentOnly(<SwarmExperimentPage />) },
          { path: 'records/swarm/:id', element: studentOnly(<SwarmRecordPage />) },
          { path: 'experiments/mission', element: studentOnly(assessmentSource === 'real' ? <RealAssessmentPage /> : <AssessmentPage />) },
          { path: 'records/assessment/:id', element: studentOnly(<AssessmentRecordPage />) },
          { path: 'experiments/security', element: studentOnly(<ExperimentComingSoonPage />) },
          { path: 'experiments/custom-security', element: studentOnly(<ExperimentComingSoonPage />) },
          { path: 'flight', element: teacherOrStudent(<FlightPage />) },
          { path: 'records', element: studentOnly(<RecordsPage />) },
          { path: 'records/:id', element: studentOnly(<RecordDetailPage />) },
          { path: 'analytics', element: studentOnly(<AnalyticsPage />) },
          { path: 'reports', element: studentOnly(<ReportsPage />) },

          // Teacher additions.
          { path: 'teacher/dashboard', element: teacherOnly(<TeacherDashboardPage />) },
          { path: 'teacher/courses', element: teacherOnly(<TeacherCoursesPage />) },
          { path: 'teacher/experiments', element: teacherOnly(<TeacherExperimentsPage />) },
          { path: 'teacher/students', element: teacherOnly(<TeacherStudentsPage />) },
          { path: 'teacher/monitor', element: teacherOnly(<TeacherMonitorPage />) },
          { path: 'teacher/grades', element: teacherOnly(<TeacherGradesPage />) },

          // Admin additions. Admin cannot access student personal records/reports/grades.
          { path: 'admin/dashboard', element: adminOnly(<AdminDashboardPage />) },
          { path: 'admin/users', element: adminOnly(<AdminUsersPage />) },
          { path: 'admin/permissions', element: adminOnly(<AdminPermissionsPage />) },
          { path: 'admin/courses', element: adminOnly(<AdminCoursesPage />) },
          { path: 'admin/experiments', element: adminOnly(<AdminExperimentsPage />) },
          { path: 'admin/resources', element: adminOnly(<AdminResourcesPage />) },
          { path: 'admin/logs', element: adminOnly(<AdminLogsPage />) },
          { path: 'settings', element: adminOnly(<AdminSettingsPage />) },

          { path: 'help', element: allRoles(<HelpPage />) },
          { path: 'profile', element: allRoles(<ProfilePage />) },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
