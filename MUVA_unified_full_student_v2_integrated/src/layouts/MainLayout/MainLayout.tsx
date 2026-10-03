import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';

import { PlatformOverlays } from '../../components/platform/PlatformOverlays';
import { useExperimentStore } from '../../stores/experimentStore';
import { useRecordsStore } from '../../stores/recordsStore';
import { Sidebar } from './Sidebar';
import { TopHeader } from './TopHeader';
import styles from './MainLayout.module.css';

export function MainLayout() {
  const initializeExperiment = useExperimentStore((state) => state.initialize);
  const refreshRecords = useRecordsStore((state) => state.refresh);

  useEffect(() => {
    void initializeExperiment();
    void refreshRecords();
  }, [initializeExperiment, refreshRecords]);

  return (
    <div className={styles.appShell}>
      <TopHeader />
      <Sidebar />
      <main className={styles.mainContent}>
        <Outlet />
      </main>
      <PlatformOverlays />
    </div>
  );
}
