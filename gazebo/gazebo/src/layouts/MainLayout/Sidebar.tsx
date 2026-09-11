import {
  BarChart3,
  BookOpenCheck,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  FileText,
  Gauge,
  GraduationCap,
  House,
  Network,
  RadioTower,
  Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { EnvironmentStatus } from '../../pages/experiments/basic-flight/components/EnvironmentStatus';
import styles from './MainLayout.module.css';

interface MenuItem {
  label: string;
  icon: LucideIcon;
  to: string;
}

const menuItems: MenuItem[] = [
  { label: '平台总览', icon: House, to: '/dashboard' },
];

const secondaryItems: MenuItem[] = [
  { label: '实时飞控', icon: RadioTower, to: '/flight' },
  { label: '实验记录', icon: ClipboardList, to: '/records' },
  { label: '数据分析', icon: BarChart3, to: '/analytics' },
  { label: '实验报告', icon: FileText, to: '/reports' },
  { label: '教学管理', icon: BookOpenCheck, to: '/teaching' },
  { label: '帮助文档', icon: CircleHelp, to: '/help' },
  { label: '系统设置', icon: Settings, to: '/settings' },
];

const experimentItems: MenuItem[] = [
  { label: '实验一 · 基础飞行', icon: Gauge, to: '/experiments/basic-flight' },
  { label: '实验二 · 集群飞行控制', icon: Network, to: '/experiments/swarm' },
  { label: '实验三 · 任务协同', icon: Network, to: '/experiments/mission' },
  { label: '实验四 · 安全攻防对抗', icon: Network, to: '/experiments/security' },
  { label: '实验五 · 自定义安全对抗', icon: Network, to: '/experiments/custom-security' },
];

export function Sidebar() {
  const { pathname } = useLocation();
  const [experimentsExpanded, setExperimentsExpanded] = useState(() => pathname.startsWith('/experiments'));

  useEffect(() => {
    if (pathname.startsWith('/experiments/')) setExperimentsExpanded(true);
  }, [pathname]);

  const navClassName = ({ isActive }: { isActive: boolean }) => `${styles.menuItem} ${isActive ? styles.activeMenuItem : ''}`;

  return (
    <aside className={styles.sidebar}>
      <nav className={styles.navigation} aria-label="主导航">
        {menuItems.map(({ label, icon: Icon, to }) => (
          <NavLink className={navClassName} to={to} key={label}>
            <Icon size={21} />
            <span>{label}</span>
          </NavLink>
        ))}
        <div className={styles.menuSection}>
          <div className={`${styles.menuItem} ${pathname.startsWith('/experiments') ? styles.activeMenuItem : ''}`}>
            <NavLink className={styles.menuSectionLink} to="/experiments">
              <GraduationCap size={21} />
              <span>实验中心</span>
            </NavLink>
            <button
              className={styles.expandButton}
              type="button"
              aria-label={experimentsExpanded ? '收起实验菜单' : '展开实验菜单'}
              aria-expanded={experimentsExpanded}
              onClick={() => setExperimentsExpanded((expanded) => !expanded)}
            >
              <ChevronDown className={experimentsExpanded ? styles.chevronExpanded : ''} size={15} />
            </button>
          </div>
          {experimentsExpanded ? (
            <div className={styles.submenu}>
              {experimentItems.map(({ label, icon: Icon, to }) => (
                <NavLink className={({ isActive }) => isActive ? styles.activeSubmenuItem : ''} to={to} key={label}>
                  <Icon size={18} />
                  <span>{label}</span>
                </NavLink>
              ))}
            </div>
          ) : null}
        </div>
        <div className={styles.menuDivider} />
        {secondaryItems.map(({ label, icon: Icon, to }) => (
          <NavLink className={navClassName} to={to} key={label}>
            <Icon size={21} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <EnvironmentStatus />
    </aside>
  );
}
