import { Bell, CheckCheck, ChevronDown, CircleHelp, LogOut, MessageSquare, Settings, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { Modal } from '../../components/common/Modal/Modal';
import { getRoleHomePath, useAuthStore } from '../../stores/authStore';
import { useEnvironmentStore } from '../../stores/environmentStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { usePlatformUiStore } from '../../stores/platformUiStore';
import styles from './MainLayout.module.css';

type HeaderPopover = 'notifications' | 'messages' | 'user' | null;

const formatRelativeTime = (timestamp: string): string => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 60_000));
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
};

export function TopHeader() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const runtime = useEnvironmentStore((state) => state.runtime);
  const isStarting = useEnvironmentStore((state) => state.isStarting);
  const openEnvironment = usePlatformUiStore((state) => state.openEnvironment);
  const showToast = usePlatformUiStore((state) => state.showToast);
  const notifications = useNotificationStore((state) => state.notifications);
  const messages = useNotificationStore((state) => state.messages);
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const displayName = useAuthStore((state) => state.displayName);
  const role = useAuthStore((state) => state.role);
  const logout = useAuthStore((state) => state.logout);
  const [now, setNow] = useState(() => new Date());
  const [activePopover, setActivePopover] = useState<HeaderPopover>(null);
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const actionAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => setActivePopover(null), [pathname]);

  useEffect(() => {
    const handlePointer = (event: MouseEvent) => {
      if (actionAreaRef.current && !actionAreaRef.current.contains(event.target as Node)) setActivePopover(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActivePopover(null);
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const togglePopover = (popover: Exclude<HeaderPopover, null>) => {
    setActivePopover((current) => current === popover ? null : popover);
  };

  const environmentRunning = runtime.gazebo === 'RUNNING'
    && runtime.ardupilotSitl === 'RUNNING'
    && runtime.mavlinkGateway === 'CONNECTED';
  const unreadCount = notifications.filter((notification) => !notification.read).length;

  const homePath = getRoleHomePath(role);

  return (
    <>
      <header className={styles.topHeader}>
        <Link className={styles.brand} to={homePath} aria-label="MUVA 平台首页">
          <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>
          <strong>MUVA</strong>
          <span>无人机教学与安全实验平台</span>
        </Link>
        <div className={styles.slogan}>探索天空 · 安全飞行 · 智能未来</div>
        <div className={styles.headerActions} ref={actionAreaRef}>
          <button className={`${styles.runtimeBadge} ${environmentRunning ? '' : styles.runtimeIdle}`} type="button" onClick={openEnvironment}>
            仿真环境：{environmentRunning ? '运行中' : isStarting ? '启动中' : '待启动'}
          </button>
          <div className={styles.headerControl}>
            <button className={`${styles.iconButton} ${activePopover === 'notifications' ? styles.headerButtonActive : ''}`} type="button" aria-label={`通知，${unreadCount} 条未读`} aria-expanded={activePopover === 'notifications'} onClick={() => togglePopover('notifications')}>
              <Bell size={19} />
              {unreadCount > 0 ? <span className={styles.unreadBadge}>{unreadCount}</span> : null}
            </button>
            {activePopover === 'notifications' ? (
              <section className={styles.popover} aria-label="通知列表">
                <header><strong>通知中心</strong><button type="button" disabled={unreadCount === 0} onClick={markAllRead}><CheckCheck size={14} />全部已读</button></header>
                <div className={styles.popoverList}>
                  {notifications.map((notification) => (
                    <button className={notification.read ? '' : styles.unreadItem} type="button" key={notification.id} onClick={() => { markRead(notification.id); showToast(`已查看：${notification.title}`); }}>
                      <span>{notification.title}</span>
                      <small>{notification.detail}</small>
                      <time>{formatRelativeTime(notification.createdAt)}</time>
                    </button>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
          <div className={styles.headerControl}>
            <button className={`${styles.iconButton} ${activePopover === 'messages' ? styles.headerButtonActive : ''}`} type="button" aria-label="消息" aria-expanded={activePopover === 'messages'} onClick={() => togglePopover('messages')}>
              <MessageSquare size={19} />
            </button>
            {activePopover === 'messages' ? (
              <section className={styles.popover} aria-label="消息列表">
                <header><strong>平台消息</strong><span>{messages.length} 条</span></header>
                <div className={styles.popoverList}>
                  {messages.map((message) => (
                    <div className={styles.messageItem} key={message.id}>
                      <span>{message.sender}</span>
                      <small>{message.content}</small>
                      <time>{formatRelativeTime(message.createdAt)}</time>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
          <div className={styles.headerControl}>
            <button className={`${styles.userButton} ${activePopover === 'user' ? styles.headerButtonActive : ''}`} type="button" aria-haspopup="menu" aria-expanded={activePopover === 'user'} onClick={() => togglePopover('user')}>
              <UserRound size={20} />
              <span>{displayName}</span>
              <ChevronDown size={15} />
            </button>
            {activePopover === 'user' ? (
              <div className={`${styles.popover} ${styles.userMenu}`} role="menu">
                <Link to="/profile" role="menuitem" onClick={() => setActivePopover(null)}><UserRound size={16} />个人信息</Link>
                {role === 'admin' ? <Link to="/settings" role="menuitem" onClick={() => setActivePopover(null)}><Settings size={16} />系统设置</Link> : null}
                <Link to="/help" role="menuitem" onClick={() => setActivePopover(null)}><CircleHelp size={16} />帮助文档</Link>
                <button type="button" role="menuitem" onClick={() => { setActivePopover(null); setConfirmingLogout(true); }}><LogOut size={16} />退出登录</button>
              </div>
            ) : null}
          </div>
          <time className={styles.headerTime} dateTime={now.toISOString()}>
            <span>{now.toLocaleDateString('zh-CN')}&nbsp;&nbsp;{now.toLocaleTimeString('zh-CN', { hour12: false })}</span>
            <small>{now.toLocaleDateString('zh-CN', { weekday: 'long' })}</small>
          </time>
        </div>
      </header>
      {confirmingLogout ? (
        <Modal title="退出账号" description="确定退出当前账号吗？" onClose={() => setConfirmingLogout(false)} width="compact">
          <div className={styles.logoutConfirm}>
            <p>退出后会清理当前浏览器会话中的登录状态；实验记录仍保留在本地。</p>
            <div>
              <button type="button" onClick={() => setConfirmingLogout(false)}>取消</button>
              <button type="button" onClick={() => { logout(); setConfirmingLogout(false); navigate('/login'); }}>确定退出</button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
