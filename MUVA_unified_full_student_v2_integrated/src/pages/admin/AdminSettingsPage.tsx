import { Database, Save, Server, Settings, ShieldCheck, TimerReset } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import styles from '../role/RolePages.module.css';

interface AdminSettings {
  platformName: string;
  semester: string;
  maxInstancesPerStudent: number;
  idleTimeoutMinutes: number;
  auditRetentionDays: number;
  allowSelfRegistration: boolean;
}

const initialSettings: AdminSettings = {
  platformName: 'MUVA 无人机教学与安全实验平台',
  semester: '2026 秋季学期',
  maxInstancesPerStudent: 1,
  idleTimeoutMinutes: 20,
  auditRetentionDays: 180,
  allowSelfRegistration: false,
};

export function AdminSettingsPage() {
  const [settings, setSettings] = useState(initialSettings);
  const [savedAt, setSavedAt] = useState('');

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSettings({
      platformName: String(form.get('platformName') ?? settings.platformName),
      semester: String(form.get('semester') ?? settings.semester),
      maxInstancesPerStudent: Number(form.get('maxInstancesPerStudent') ?? settings.maxInstancesPerStudent),
      idleTimeoutMinutes: Number(form.get('idleTimeoutMinutes') ?? settings.idleTimeoutMinutes),
      auditRetentionDays: Number(form.get('auditRetentionDays') ?? settings.auditRetentionDays),
      allowSelfRegistration: form.get('allowSelfRegistration') === 'on',
    });
    setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
  };

  return (
    <section className={styles.rolePage}>
      <header className={styles.compactHeader}>
        <div><h1>系统设置</h1><p>配置教学平台基础参数、仿真实例限制和审计策略。开发期仅保存在当前页面状态。</p></div>
        <span><Settings size={14} /> 平台级配置</span>
      </header>

      <form className={styles.settingsGrid} onSubmit={save}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div className={styles.panelTitle}><Database size={16} />平台基础信息</div><span className={styles.panelSubtle}>后续由配置 API 持久化</span></div>
          <div className={styles.settingsForm}>
            <label>平台名称<input name="platformName" defaultValue={settings.platformName} /></label>
            <label>当前学期<input name="semester" defaultValue={settings.semester} /></label>
            <label className={styles.toggleSetting}><span><strong>允许学生自行注册</strong><small>教学平台建议默认关闭，由管理员统一创建账号</small></span><input name="allowSelfRegistration" type="checkbox" defaultChecked={settings.allowSelfRegistration} /></label>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}><div className={styles.panelTitle}><Server size={16} />仿真资源策略</div><span className={styles.panelSubtle}>防止单用户过量占用资源</span></div>
          <div className={styles.settingsForm}>
            <label>每名学生最大并发实例<input name="maxInstancesPerStudent" type="number" min="1" max="4" defaultValue={settings.maxInstancesPerStudent} /></label>
            <label>空闲实例自动释放（分钟）<input name="idleTimeoutMinutes" type="number" min="5" max="120" defaultValue={settings.idleTimeoutMinutes} /></label>
            <div className={styles.settingInfo}><TimerReset size={15} /><span>正式接后端后，由资源调度服务依据以上策略释放 Gazebo / SITL 实例。</span></div>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.settingsWide}`}>
          <div className={styles.panelHeader}><div className={styles.panelTitle}><ShieldCheck size={16} />安全与审计</div><span className={styles.panelSubtle}>管理员仍无学生个人实验数据访问权限</span></div>
          <div className={styles.settingsFormInline}>
            <label>审计日志保留天数<input name="auditRetentionDays" type="number" min="30" max="1095" defaultValue={settings.auditRetentionDays} /></label>
            <div className={styles.privacyBoundaryBox}><ShieldCheck size={15} /><div><strong>权限边界固定</strong><span>系统设置不提供“开放学生实验记录给管理员”的开关。学生轨迹、遥测、报告和个人成绩仍由教师与学生权限控制。</span></div></div>
          </div>
        </section>

        <div className={styles.settingsActions}>
          <span>{savedAt ? `本地演示配置已保存 · ${savedAt}` : '预留接口：PATCH /api/admin/settings'}</span>
          <button className={styles.primaryButton} type="submit"><Save size={14} />保存设置</button>
        </div>
      </form>
    </section>
  );
}
