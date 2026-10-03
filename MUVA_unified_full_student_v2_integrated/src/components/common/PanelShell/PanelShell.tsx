import type { LucideIcon } from 'lucide-react';
import type { PropsWithChildren, ReactNode } from 'react';

import styles from './PanelShell.module.css';

interface PanelShellProps extends PropsWithChildren {
  title: string;
  icon: LucideIcon;
  className?: string;
  action?: ReactNode;
  emphasis?: 'primary' | 'secondary' | 'tertiary';
}

export function PanelShell({
  title,
  icon: Icon,
  className = '',
  action,
  emphasis = 'tertiary',
  children,
}: PanelShellProps) {
  return (
    <section className={`${styles.panel} ${styles[emphasis]} ${className}`}>
      <header className={styles.header}>
        <div className={styles.title}>
          <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
          <span>{title}</span>
        </div>
        {action ? <div className={styles.action}>{action}</div> : null}
      </header>
      <div className={styles.body}>{children}</div>
    </section>
  );
}
