import { ShieldCheck, UserRound } from 'lucide-react';

import { useAuthStore } from '../../stores/authStore';
import styles from './PlatformPages.module.css';

export function ProfilePage() {
  const displayName = useAuthStore((state) => state.displayName);
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>个人信息</h1><p>当前账号用于教学演示与实验记录管理。</p></div>
        <span><ShieldCheck size={16} />当前会话</span>
      </header>
      <section className={`${styles.panel} ${styles.profileCard}`}>
        <span className={styles.avatar}><UserRound size={48} /></span>
        <div className={styles.profileInfo}>
          <h2>{displayName}</h2>
          <p>MUVA 无人机教学与安全实验平台 · 系统管理员</p>
          <dl className={styles.definitionList}>
            <div><dt>账号类型</dt><dd>教学管理员</dd></div>
            <div><dt>当前权限</dt><dd>教学演示</dd></div>
            <div><dt>登录方式</dt><dd>浏览器 Session</dd></div>
            <div><dt>数据范围</dt><dd>本地实验记录</dd></div>
          </dl>
        </div>
      </section>
    </div>
  );
}
