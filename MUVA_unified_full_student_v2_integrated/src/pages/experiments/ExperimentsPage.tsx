import { ArrowRight, FlaskConical } from 'lucide-react';
import { Link } from 'react-router-dom';

import { experimentCatalog } from './catalog';
import styles from '../platform/PlatformPages.module.css';

export function ExperimentsPage() {
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>实验中心</h1><p>从基础飞行开始，逐步进入任务协同、集群控制与无人机安全实验。</p></div>
        <span><FlaskConical size={16} />5 个教学实验</span>
      </header>
      <div className={styles.experimentGrid}>
        {experimentCatalog.map(({ number, title, subtitle, description, path, status, icon: Icon }) => (
          <Link className={styles.experimentCard} to={path} key={path}>
            <Icon size={29} />
            <i>{status}</i>
            <h2>{number}</h2>
            <h3>{title} · {subtitle}</h3>
            <p>{description}</p>
            <span>{status === '可开始' ? '进入实验' : '查看建设计划'} <ArrowRight size={14} /></span>
          </Link>
        ))}
      </div>
    </div>
  );
}
