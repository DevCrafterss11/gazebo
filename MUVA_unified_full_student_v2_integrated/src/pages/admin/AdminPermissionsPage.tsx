import { LockKeyhole, Save, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import styles from '../role/RolePages.module.css';

type RoleKey = 'admin' | 'teacher' | 'student';

interface PermissionRow {
  key: string;
  label: string;
  scope: string;
  admin: boolean;
  teacher: boolean;
  student: boolean;
  locked?: boolean;
}

const initialPermissions: PermissionRow[] = [
  { key: 'user.manage', label: '用户与账号管理', scope: '全平台账号', admin: true, teacher: false, student: false },
  { key: 'course.manage', label: '课程管理', scope: '平台 / 所属课程 / 本人课程', admin: true, teacher: true, student: false },
  { key: 'experiment.definition', label: '实验定义与配置', scope: '管理员可修改教师实验', admin: true, teacher: true, student: false },
  { key: 'experiment.execute', label: '执行仿真实验', scope: '教学演示 / 本人实验', admin: false, teacher: true, student: true },
  { key: 'student.records', label: '学生实验记录', scope: '所属课程 / 本人', admin: false, teacher: true, student: true, locked: true },
  { key: 'student.report', label: '实验报告与成绩详情', scope: '所属课程 / 本人', admin: false, teacher: true, student: true, locked: true },
  { key: 'resource.manage', label: '仿真资源运维', scope: '全平台资源', admin: true, teacher: false, student: false },
  { key: 'audit.view', label: '操作日志审计', scope: '平台管理事件', admin: true, teacher: false, student: false },
];

const roleName: Record<RoleKey, string> = { admin: '管理员', teacher: '教师', student: '学生' };

export function AdminPermissionsPage() {
  const [permissions, setPermissions] = useState(initialPermissions);
  const [selectedRole, setSelectedRole] = useState<RoleKey>('admin');
  const [savedAt, setSavedAt] = useState('');

  const allowedCount = useMemo(() => permissions.filter((item) => item[selectedRole]).length, [permissions, selectedRole]);

  const toggle = (permissionKey: string) => {
    setPermissions((items) => items.map((item) => {
      if (item.key !== permissionKey) return item;
      if (item.locked && selectedRole === 'admin') return item;
      return { ...item, [selectedRole]: !item[selectedRole] };
    }));
  };

  return (
    <section className={styles.rolePage}>
      <header className={styles.compactHeader}>
        <div><h1>角色权限</h1><p>采用 RBAC + 数据范围控制。这里先完成权限配置前端，后端接入后由权限编码和数据域共同校验。</p></div>
        <span><ShieldCheck size={14} /> RBAC + 数据权限</span>
      </header>

      <section className={`${styles.panel} ${styles.permissionOverview}`}>
        <div className={styles.roleTabs}>
          {(['admin', 'teacher', 'student'] as RoleKey[]).map((role) => <button className={selectedRole === role ? styles.roleTabActive : ''} type="button" onClick={() => setSelectedRole(role)} key={role}>{roleName[role]}</button>)}
        </div>
        <div className={styles.permissionSummary}><span>当前角色</span><strong>{roleName[selectedRole]}</strong><span>已启用 {allowedCount} 项页面/业务权限</span><button className={styles.primaryButton} type="button" onClick={() => setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }))}><Save size={13} />保存权限</button></div>
      </section>

      <section className={styles.panel} style={{ marginTop: 12 }}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><LockKeyhole size={16} />权限矩阵</div><span className={styles.panelSubtle}>{savedAt ? `本地演示已保存 · ${savedAt}` : '预留接口：PUT /api/admin/roles/{role}/permissions'}</span></div>
        <div className={styles.permissionMatrix}>
          <div className={styles.permissionMatrixHead}><span>权限模块</span><span>数据范围</span><span>管理员</span><span>教师</span><span>学生</span></div>
          {permissions.map((item) => (
            <div className={styles.permissionMatrixRow} key={item.key}>
              <div className={styles.identityCopy}><strong>{item.label}</strong><span>{item.key}</span></div>
              <span>{item.scope}</span>
              {(['admin', 'teacher', 'student'] as RoleKey[]).map((role) => {
                const isProtectedAdminPrivacy = item.locked && role === 'admin';
                return <label className={isProtectedAdminPrivacy ? styles.permissionLocked : ''} key={role}><input type="checkbox" checked={item[role]} disabled={isProtectedAdminPrivacy} onChange={() => { setSelectedRole(role); setPermissions((items) => items.map((row) => row.key === item.key ? { ...row, [role]: !row[role] } : row)); }} /><span>{isProtectedAdminPrivacy ? '固定禁止' : item[role] ? '允许' : '禁止'}</span></label>;
              })}
            </div>
          ))}
        </div>
      </section>

      <section className={styles.panel} style={{ marginTop: 12 }}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><ShieldCheck size={16} />管理员固定数据边界</div><span className={styles.panelSubtle}>该边界不允许通过普通角色配置解除</span></div>
        <div className={styles.inlineNotices}>
          <span><ShieldCheck size={13} /><strong>允许</strong>修改教师创建的实验定义、版本和发布状态</span>
          <span><ShieldCheck size={13} /><strong>允许</strong>管理学生账号与课程成员关系</span>
          <span><LockKeyhole size={13} /><strong>禁止</strong>进入学生个人实验记录、轨迹和遥测</span>
          <span><LockKeyhole size={13} /><strong>禁止</strong>读取学生实验报告和个人成绩详情</span>
        </div>
      </section>
    </section>
  );
}
