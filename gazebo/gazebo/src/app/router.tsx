import { createBrowserRouter, Navigate } from 'react-router-dom';

import { ExperimentLayout } from '../layouts/ExperimentLayout/ExperimentLayout';
import { MainLayout } from '../layouts/MainLayout/MainLayout';
import { ProtectedLayout } from '../layouts/MainLayout/ProtectedLayout';
import { BasicFlightPage } from '../pages/experiments/basic-flight/BasicFlightPage';
import { ExperimentComingSoonPage } from '../pages/experiments/ExperimentComingSoonPage';
import { ExperimentsPage } from '../pages/experiments/ExperimentsPage';
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
import { SettingsPage } from '../pages/platform/SettingsPage';
import { TeachingPage } from '../pages/platform/TeachingPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <ProtectedLayout />,
    children: [
      {
        element: <MainLayout />,
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'experiments', element: <ExperimentsPage /> },
          {
            path: 'experiments/basic-flight',
            element: <ExperimentLayout />,
            children: [{ index: true, element: <BasicFlightPage /> }],
          },
          { path: 'experiments/swarm', element: <ExperimentComingSoonPage /> },
          { path: 'experiments/mission', element: <ExperimentComingSoonPage /> },
          { path: 'experiments/security', element: <ExperimentComingSoonPage /> },
          { path: 'experiments/custom-security', element: <ExperimentComingSoonPage /> },
          { path: 'flight', element: <FlightPage /> },
          { path: 'records', element: <RecordsPage /> },
          { path: 'records/:id', element: <RecordDetailPage /> },
          { path: 'analytics', element: <AnalyticsPage /> },
          { path: 'reports', element: <ReportsPage /> },
          { path: 'teaching', element: <TeachingPage /> },
          { path: 'help', element: <HelpPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: 'profile', element: <ProfilePage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
