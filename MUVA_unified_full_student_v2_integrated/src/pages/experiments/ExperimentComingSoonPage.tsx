import { CheckCircle2, Construction } from 'lucide-react';
import { Link, Navigate, useLocation } from 'react-router-dom';

import { experimentCatalog } from './catalog';
import styles from '../platform/PlatformPages.module.css';

export function ExperimentComingSoonPage() {
  const { pathname } = useLocation();
  const experiment = experimentCatalog.find((item) => item.path === pathname);

  if (!experiment) return <Navigate to="/experiments" replace />;

  return (
    <div className={styles.comingPage}>
      <section className={styles.comingCard}>
        <span className={styles.comingIcon}><Construction size={34} /></span>
        <h1>{experiment.number}：{experiment.title}</h1>
        <p>状态：正在建设中</p>
        <div className={styles.planGrid}>
          {experiment.plans.map((plan) => <span key={plan}><CheckCircle2 size={15} />{plan}</span>)}
        </div>
        <Link className={styles.primaryButton} to="/experiments">返回实验中心</Link>
      </section>
    </div>
  );
}
