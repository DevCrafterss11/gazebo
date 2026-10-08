import {
  BarChart3,
  Beaker,
  BookOpenCheck,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  FileText,
  Gauge,
  GraduationCap,
  House,
  KeyRound,
  Network,
  RadioTower,
  ScrollText,
  Server,
  Settings,
  Trophy,
  UserCog,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

import { EnvironmentStatus } from '../../pages/experiments/basic-flight/components/EnvironmentStatus';
import { useAssessmentStore } from '../../stores/assessmentStore';
import { assessmentSource } from '../../services/assessment/droneAdapter';
import { useAuthStore } from '../../stores/authStore';
import styles from './MainLayout.module.css';

interface MenuItem {
  label: string;
  icon: LucideIcon;
  to: string;
}

// Student navigation deliberately retains the original frontend structure.
const studentPrimary: MenuItem[] = [
  { label: '平台总览', icon: House, to: '/dashboard' },
  { label: '我的课程', icon: BookOpenCheck, to: '/courses' },
];

const studentSecondary: MenuItem[] = [
  { label: '实时飞控', icon: RadioTower, to: '/flight' },
  { label: '实验记录', icon: ClipboardList, to: '/records' },
  { label: '数据分析', icon: BarChart3, to: '/analytics' },
  { label: '实验报告', icon: FileText, to: '/reports' },
  { label: '我的成绩', icon: Trophy, to: '/grades' },
  { label: '帮助文档', icon: CircleHelp, to: '/help' },
];

const experimentItems: MenuItem[] = [
  { label: '实验一 · 基础飞行', icon: Gauge, to: '/experiments/basic-flight' },
  { label: '实验二 · 集群飞行控制', icon: Network, to: '/experiments/swarm' },
  { label: '实验三 · 综合飞行考核', icon: Network, to: '/experiments/mission' },
  { label: '实验四 · 安全攻防对抗', icon: Network, to: '/experiments/security' },
  { label: '实验五 · 自定义安全对抗', icon: Network, to: '/experiments/custom-security' },
];

const teacherItems: MenuItem[] = [
  { label: '教师工作台', icon: House, to: '/teacher/dashboard' },
  { label: '我的课程', icon: BookOpenCheck, to: '/teacher/courses' },
  { label: '实验管理', icon: ClipboardList, to: '/teacher/experiments' },
  { label: '学生管理', icon: Users, to: '/teacher/students' },
  { label: '实验监控', icon: RadioTower, to: '/teacher/monitor' },
  { label: '成绩管理', icon: Trophy, to: '/teacher/grades' },
  { label: '仿真演示', icon: Gauge, to: '/flight' },
  { label: '帮助文档', icon: CircleHelp, to: '/help' },
];

const adminItems: MenuItem[] = [
  { label: '系统总览', icon: House, to: '/admin/dashboard' },
  { label: '用户管理', icon: UserCog, to: '/admin/users' },
  { label: '角色权限', icon: KeyRound, to: '/admin/permissions' },
  { label: '课程管理', icon: BookOpenCheck, to: '/admin/courses' },
  { label: '实验管理', icon: Beaker, to: '/admin/experiments' },
  { label: '仿真资源', icon: Server, to: '/admin/resources' },
  { label: '操作日志', icon: ScrollText, to: '/admin/logs' },
  { label: '系统设置', icon: Settings, to: '/settings' },
  { label: '帮助文档', icon: CircleHelp, to: '/help' },
];

export function Sidebar() {
  const { pathname } = useLocation();
  const role = useAuthStore((state) => state.role);
  const [experimentsExpanded, setExperimentsExpanded] = useState(() => pathname.startsWith('/experiments'));
  const assessmentEnvironment = useAssessmentStore((state) => state.run.environment);

  useEffect(() => {
    if (pathname.startsWith('/experiments/')) setExperimentsExpanded(true);
  }, [pathname]);

  const navClassName = ({ isActive }: { isActive: boolean }) => `${styles.menuItem} ${isActive ? styles.activeMenuItem : ''}`;

  if (role === 'admin') {
    return (
      <aside className={styles.sidebar}>
        <nav className={styles.navigation} aria-label="管理员导航">
          {adminItems.map(({ label, icon: Icon, to }) => (
            <div key={label}>
              {label === '系统设置' ? <div className={styles.menuDivider} /> : null}
              <NavLink className={navClassName} to={to}><Icon size={21} /><span>{label}</span></NavLink>
            </div>
          ))}
        </nav>
        <EnvironmentStatus />
      </aside>
    );
  }

  if (role === 'teacher') {
    return (
      <aside className={styles.sidebar}>
        <nav className={styles.navigation} aria-label="教师导航">
          {teacherItems.map(({ label, icon: Icon, to }) => (
            <NavLink className={navClassName} to={to} key={label}><Icon size={21} /><span>{label}</span></NavLink>
          ))}
        </nav>
        <EnvironmentStatus />
      </aside>
    );
  }

  return (
    <aside className={styles.sidebar}>
      <nav className={styles.navigation} aria-label="学生导航">
        {studentPrimary.map(({ label, icon: Icon, to }) => (
          <NavLink className={navClassName} to={to} key={label}><Icon size={21} /><span>{label}</span></NavLink>
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
        {studentSecondary.map(({ label, icon: Icon, to }) => (
          <NavLink className={navClassName} to={to} key={label}><Icon size={21} /><span>{label}</span></NavLink>
        ))}
      </nav>
      {/* Preserve the original simulator status block for the student frontend. */}
      {pathname.startsWith('/experiments/mission') ? <div className={styles.menuSection}><strong>实验三 · {assessmentSource === 'real' ? '真实只读观测' : '前端 Mock 环境'}</strong><p>{assessmentSource === 'real' ? '禁止启动或接管共享飞控' : `模拟状态：${assessmentEnvironment}`}</p><small>{assessmentSource === 'real' ? '遥测仅显示已验证的真实数据' : '不连接 Gazebo / SITL / MAVLink'}</small></div> : <EnvironmentStatus />}
    </aside>
  );
}
