import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import styles from './EmptyState.module.css';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <section className={styles.emptyState}>
      <span><Icon size={32} /></span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div>{action}</div> : null}
    </section>
  );
}
