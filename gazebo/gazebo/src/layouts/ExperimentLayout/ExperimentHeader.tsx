import styles from './ExperimentLayout.module.css';

interface ExperimentHeaderProps {
  title: string;
  subtitle: string;
}

export function ExperimentHeader({ title, subtitle }: ExperimentHeaderProps) {
  return (
    <header className={styles.experimentHeader}>
      <div className={styles.headerCopy}>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className={styles.droneSilhouette} aria-hidden="true">
        <span className={styles.rotorLeft} />
        <span className={styles.rotorRight} />
        <span className={styles.droneBody} />
      </div>
      <div className={styles.headerMotto}>
        <span>知行合一</span>
        <span>从这里起飞</span>
      </div>
    </header>
  );
}
