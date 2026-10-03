import { Ban, CheckCircle2, Pencil, Plus, Search, UserCog, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Modal } from '../../components/common/Modal/Modal';
import { adminApi } from '../../services/adminApi';
import type { AdminUser, AdminUserRole, AdminUserStatus, CreateAdminUserInput } from '../../types/admin';
import styles from '../role/RolePages.module.css';

const roleText: Record<AdminUserRole, string> = { admin: '管理员', teacher: '教师', student: '学生' };
const statusText: Record<AdminUserStatus, string> = { active: '正常', disabled: '已停用' };

interface UserDraft {
  name: string;
  username: string;
  role: AdminUserRole;
  organization: string;
  password: string;
}

const emptyDraft: UserDraft = {
  name: '',
  username: '',
  role: 'student',
  organization: '',
  password: '12345678',
};

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [keyword, setKeyword] = useState('');
  const [role, setRole] = useState<AdminUserRole | 'all'>('all');
  const [status, setStatus] = useState<AdminUserStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await adminApi.listUsers();
      setUsers(result.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '用户数据加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadUsers(); }, []);

  const filtered = useMemo(() => users.filter((item) => {
    const text = `${item.name}${item.username}${item.organization}`.toLowerCase();
    const matchesKeyword = !keyword.trim() || text.includes(keyword.trim().toLowerCase());
    const matchesRole = role === 'all' || item.role === role;
    const matchesStatus = status === 'all' || item.status === status;
    return matchesKeyword && matchesRole && matchesStatus;
  }), [keyword, role, status, users]);

  const counts = useMemo(() => ({
    total: users.length,
    teachers: users.filter((item) => item.role === 'teacher').length,
    students: users.filter((item) => item.role === 'student').length,
    disabled: users.filter((item) => item.status === 'disabled').length,
  }), [users]);

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: CreateAdminUserInput = {
      name: String(form.get('name') ?? '').trim(),
      username: String(form.get('username') ?? '').trim(),
      role: String(form.get('role') ?? 'student') as AdminUserRole,
      organization: String(form.get('organization') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    };
    if (!input.name || !input.username || !input.organization || input.password.length < 6) {
      setError('请完整填写用户信息，初始密码至少 6 位。');
      return;
    }
    try {
      const created = await adminApi.createUser(input);
      setUsers((items) => [created, ...items]);
      setCreating(false);
      setError('');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建用户失败');
    }
  };

  const updateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    try {
      const updated = await adminApi.updateUser(editing.id, {
        name: String(form.get('name') ?? editing.name).trim(),
        role: String(form.get('role') ?? editing.role) as AdminUserRole,
        organization: String(form.get('organization') ?? editing.organization).trim(),
      });
      setUsers((items) => items.map((item) => item.id === updated.id ? updated : item));
      setEditing(null);
      setError('');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '更新用户失败');
    }
  };

  const toggleStatus = async (user: AdminUser) => {
    const nextStatus: AdminUserStatus = user.status === 'active' ? 'disabled' : 'active';
    try {
      const updated = await adminApi.updateUser(user.id, { status: nextStatus });
      setUsers((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '账号状态更新失败');
    }
  };

  return (
    <section className={styles.rolePage}>
      <header className={styles.compactHeader}>
        <div><h1>用户管理</h1><p>维护管理员、教师与学生账号。开发阶段使用 Mock Service，后端就绪后可直接切换管理端 API。</p></div>
        <span><Users size={14} /> 账号与身份管理</span>
      </header>

      <section className={`${styles.panel} ${styles.adminSummaryPanel}`}>
        <div className={styles.miniSummaryGrid}>
          <div><span>当前演示用户</span><strong>{counts.total}</strong><small>正式接口将返回全平台数量</small></div>
          <div><span>教师账号</span><strong>{counts.teachers}</strong><small>可创建课程与教学实验</small></div>
          <div><span>学生账号</span><strong>{counts.students}</strong><small>仅访问本人课程与实验</small></div>
          <div><span>停用账号</span><strong>{counts.disabled}</strong><small>停用后禁止登录平台</small></div>
        </div>
      </section>

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <label className={styles.search}><Search size={13} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索姓名 / 账号 / 班级" /></label>
          <select className={styles.filter} value={role} onChange={(event) => setRole(event.target.value as AdminUserRole | 'all')}>
            <option value="all">全部角色</option><option value="admin">管理员</option><option value="teacher">教师</option><option value="student">学生</option>
          </select>
          <select className={styles.filter} value={status} onChange={(event) => setStatus(event.target.value as AdminUserStatus | 'all')}>
            <option value="all">全部状态</option><option value="active">正常</option><option value="disabled">已停用</option>
          </select>
        </div>
        <button className={styles.primaryButton} type="button" onClick={() => { setCreating(true); setError(''); }}><Plus size={14} />新增用户</button>
      </div>

      {error ? <div className={styles.pageMessage}>{error}</div> : null}

      <section className={styles.panel}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><UserCog size={16} />用户账号</div><span className={styles.panelSubtle}>当前筛选 {filtered.length} 项 · 管理员不可由此进入学生个人实验记录</span></div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.adminUsersV2}`}><span>用户</span><span>账号</span><span>角色</span><span>所属 / 班级</span><span>状态</span><span>操作</span></div>
          {loading ? <div className={styles.emptyHint}>正在加载用户数据…</div> : filtered.map((user) => (
            <div className={`${styles.tableRow} ${styles.adminUsersV2}`} key={user.id}>
              <div className={styles.studentIdentity}><span className={styles.avatar}>{user.name.slice(0, 1)}</span><div className={styles.identityCopy}><strong>{user.name}</strong><span>创建于 {user.createdAt}</span></div></div>
              <strong>{user.username}</strong>
              <span className={styles.roleBadge}>{roleText[user.role]}</span>
              <span>{user.organization}</span>
              <span className={user.status === 'active' ? styles.successText : styles.dangerText}>{statusText[user.status]}</span>
              <div className={styles.rowActions}>
                <button className={styles.iconAction} title="编辑用户" type="button" onClick={() => { setEditing(user); setError(''); }}><Pencil size={13} /></button>
                {user.role === 'admin' ? <span className={styles.lockedAction}>系统账号</span> : (
                  <button className={`${styles.iconAction} ${user.status === 'active' ? styles.iconDanger : styles.iconSuccess}`} title={user.status === 'active' ? '停用账号' : '启用账号'} type="button" onClick={() => void toggleStatus(user)}>{user.status === 'active' ? <Ban size={13} /> : <CheckCircle2 size={13} />}</button>
                )}
              </div>
            </div>
          ))}
          {!loading && filtered.length === 0 ? <div className={styles.emptyHint}>没有符合条件的用户</div> : null}
        </div>
      </section>

      {creating ? (
        <Modal title="新增用户" description="创建账号后，正式后端可在此触发初始密码下发与审计记录。" onClose={() => setCreating(false)}>
          <form className={styles.adminForm} onSubmit={createUser}>
            <div className={styles.formGrid}>
              <label>姓名<input name="name" placeholder="例如：赵老师" autoFocus /></label>
              <label>登录账号<input name="username" placeholder="例如：teacher03" /></label>
              <label>角色<select name="role" defaultValue={emptyDraft.role}><option value="student">学生</option><option value="teacher">教师</option><option value="admin">管理员</option></select></label>
              <label>所属 / 班级<input name="organization" placeholder="例如：自动化2班" /></label>
              <label className={styles.formSpanTwo}>初始密码<input name="password" type="password" defaultValue={emptyDraft.password} /></label>
            </div>
            <div className={styles.formHint}>预留接口：POST /api/admin/users。当前仅写入前端 Mock 数据，不影响现有无人机后端。</div>
            <div className={styles.formActions}><button className={styles.ghostButton} type="button" onClick={() => setCreating(false)}>取消</button><button className={styles.primaryButton} type="submit">创建账号</button></div>
          </form>
        </Modal>
      ) : null}

      {editing ? (
        <Modal title={`编辑用户 · ${editing.name}`} description={`账号 ${editing.username} 不可在前端直接修改，避免与登录身份发生冲突。`} onClose={() => setEditing(null)}>
          <form className={styles.adminForm} onSubmit={updateUser}>
            <div className={styles.formGrid}>
              <label>姓名<input name="name" defaultValue={editing.name} /></label>
              <label>登录账号<input value={editing.username} disabled /></label>
              <label>角色<select name="role" defaultValue={editing.role}><option value="student">学生</option><option value="teacher">教师</option><option value="admin">管理员</option></select></label>
              <label>所属 / 班级<input name="organization" defaultValue={editing.organization} /></label>
            </div>
            <div className={styles.formActions}><button className={styles.ghostButton} type="button" onClick={() => setEditing(null)}>取消</button><button className={styles.primaryButton} type="submit">保存修改</button></div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
