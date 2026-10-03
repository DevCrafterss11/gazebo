import { Beaker, FilePenLine, History, LockKeyhole, Search, ShieldCheck } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

import { Modal } from '../../components/common/Modal/Modal';
import styles from '../role/RolePages.module.css';

type ExperimentStatus = '草稿' | '已发布' | '进行中' | '已结束';

interface AdminExperiment {
  id: number;
  name: string;
  course: string;
  teacher: string;
  status: ExperimentStatus;
  version: number;
  totalStudents: number;
  startedStudents: number;
  completedStudents: number;
  maxAltitude: number;
  duration: number;
  allowMissionEdit: boolean;
  allowPidEdit: boolean;
  updatedAt: string;
}

interface AuditEntry {
  id: number;
  experimentId: number;
  time: string;
  operator: string;
  action: string;
}

const initialExperiments: AdminExperiment[] = [
  { id: 1, name: '基础飞行控制实验', course: '无人机飞行控制', teacher: '张老师', status: '已结束', version: 2, totalStudents: 42, startedStudents: 42, completedStudents: 42, maxAltitude: 20, duration: 30, allowMissionEdit: false, allowPidEdit: false, updatedAt: '2026-09-12 16:20' },
  { id: 2, name: '航点任务规划实验', course: '无人机飞行控制', teacher: '张老师', status: '进行中', version: 1, totalStudents: 42, startedStudents: 35, completedStudents: 28, maxAltitude: 30, duration: 45, allowMissionEdit: true, allowPidEdit: false, updatedAt: '2026-09-14 13:42' },
  { id: 3, name: 'PID 参数调节实验', course: '飞行控制原理', teacher: '李老师', status: '已发布', version: 1, totalStudents: 38, startedStudents: 0, completedStudents: 0, maxAltitude: 15, duration: 60, allowMissionEdit: false, allowPidEdit: true, updatedAt: '2026-09-13 10:08' },
  { id: 4, name: 'GPS 故障处理实验', course: '无人机安全实验', teacher: '王老师', status: '草稿', version: 1, totalStudents: 36, startedStudents: 0, completedStudents: 0, maxAltitude: 20, duration: 40, allowMissionEdit: true, allowPidEdit: false, updatedAt: '2026-09-14 09:16' },
];

const initialAudit: AuditEntry[] = [
  { id: 1, experimentId: 1, time: '2026-09-10 09:30', operator: '系统管理员', action: '修改最大飞行高度 25m → 20m，并生成 V2' },
  { id: 2, experimentId: 2, time: '2026-09-14 13:42', operator: '张老师', action: '更新实验任务说明' },
  { id: 3, experimentId: 3, time: '2026-09-13 10:08', operator: '李老师', action: '发布实验 V1' },
];

const formatNow = () => new Date().toLocaleString('zh-CN', { hour12: false }).replaceAll('/', '-');

export function AdminExperimentsPage() {
  const [experiments, setExperiments] = useState(initialExperiments);
  const [auditEntries, setAuditEntries] = useState(initialAudit);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<'全部状态' | ExperimentStatus>('全部状态');
  const [editingId, setEditingId] = useState<number | null>(null);

  const editing = editingId === null ? null : experiments.find((item) => item.id === editingId) ?? null;
  const filtered = useMemo(() => experiments.filter((item) => {
    const matchesKeyword = !keyword.trim() || `${item.name}${item.course}${item.teacher}`.toLowerCase().includes(keyword.trim().toLowerCase());
    const matchesStatus = statusFilter === '全部状态' || item.status === statusFilter;
    return matchesKeyword && matchesStatus;
  }), [experiments, keyword, statusFilter]);

  const saveExperiment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const nextName = String(form.get('name') ?? editing.name).trim() || editing.name;
    const nextMaxAltitude = Number(form.get('maxAltitude') ?? editing.maxAltitude);
    const nextDuration = Number(form.get('duration') ?? editing.duration);
    const nextAllowMissionEdit = form.get('allowMissionEdit') === 'on';
    const nextAllowPidEdit = form.get('allowPidEdit') === 'on';
    const createsVersion = editing.startedStudents > 0;
    const nextVersion = createsVersion ? editing.version + 1 : editing.version;
    const now = formatNow();

    setExperiments((items) => items.map((item) => item.id === editing.id ? {
      ...item,
      name: nextName,
      maxAltitude: Number.isFinite(nextMaxAltitude) ? nextMaxAltitude : item.maxAltitude,
      duration: Number.isFinite(nextDuration) ? nextDuration : item.duration,
      allowMissionEdit: nextAllowMissionEdit,
      allowPidEdit: nextAllowPidEdit,
      version: nextVersion,
      updatedAt: now,
    } : item));

    const versionNote = createsVersion
      ? `生成 V${nextVersion}；已开始实验的 ${editing.startedStudents} 名学生继续使用 V${editing.version}`
      : editing.status === '已发布'
        ? `更新已发布实验 V${editing.version}；当前尚无学生开始`
        : `修改实验配置 V${editing.version}`;

    setAuditEntries((entries) => [{ id: Date.now(), experimentId: editing.id, time: now, operator: '系统管理员', action: versionNote }, ...entries]);
    setEditingId(null);
  };

  return (
    <section className={styles.rolePage}>
      <header className={styles.compactHeader}>
        <div><h1>实验管理</h1><p>管理员可维护教师创建的实验配置与版本，但不能访问学生个人实验记录、轨迹、报告或成绩。</p></div>
        <span><ShieldCheck size={14} /> 教学资源管理</span>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <label className={styles.search}><Search size={13} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索实验 / 课程 / 教师" /></label>
          <select className={styles.filter} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as '全部状态' | ExperimentStatus)}>
            <option>全部状态</option><option>草稿</option><option>已发布</option><option>进行中</option><option>已结束</option>
          </select>
        </div>
        <span className={styles.permissionBoundary}><LockKeyhole size={13} /> 学生个人实验数据：无访问权限</span>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitle}><Beaker size={17} />全平台实验</div>
          <span className={styles.panelSubtle}>仅展示实验配置和汇总进度，共 {filtered.length} 项</span>
        </div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.adminExperiments}`}>
            <span>实验名称</span><span>所属课程</span><span>创建教师</span><span>状态</span><span>版本</span><span>汇总进度</span><span>操作</span>
          </div>
          {filtered.map((item) => {
            const stateClass = item.status === '已结束' ? styles.success : item.status === '进行中' ? styles.warning : '';
            return (
              <div className={`${styles.tableRow} ${styles.adminExperiments}`} key={item.id}>
                <div className={styles.identityCopy}><strong>{item.name}</strong><span>最后修改：{item.updatedAt}</span></div>
                <span>{item.course}</span><span>{item.teacher}</span>
                <span className={`${styles.statusPill} ${stateClass}`}>{item.status}</span>
                <strong>V{item.version}</strong>
                <div className={styles.identityCopy}><strong>{item.completedStudents} / {item.totalStudents} 完成</strong><span>{item.startedStudents} 人已开始</span></div>
                <button className={styles.ghostButton} type="button" onClick={() => setEditingId(item.id)}><FilePenLine size={12} />编辑</button>
              </div>
            );
          })}
        </div>
      </section>

      <section className={styles.panel} style={{ marginTop: 12 }}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><History size={17} />实验修改记录</div><span className={styles.panelSubtle}>管理员与教师的重要修改均应进入审计日志</span></div>
        <div className={styles.compactRows}>
          {auditEntries.slice(0, 5).map((entry) => {
            const experiment = experiments.find((item) => item.id === entry.experimentId);
            return <div className={styles.auditRow} key={entry.id}><time>{entry.time}</time><strong>{experiment?.name ?? '实验'}</strong><span>{entry.operator}</span><em>{entry.action}</em></div>;
          })}
        </div>
      </section>

      {editing ? (
        <Modal title={`编辑实验 · ${editing.name}`} description={`创建教师：${editing.teacher} · 当前 V${editing.version}`} onClose={() => setEditingId(null)} width="wide">
          <form className={styles.adminExperimentForm} onSubmit={saveExperiment}>
            {editing.startedStudents > 0 ? (
              <div className={styles.versionWarning}><History size={16} /><div><strong>该实验已有 {editing.startedStudents} 名学生开始</strong><span>本次保存将生成 V{editing.version + 1}。已开始学生继续使用 V{editing.version}，新版本只影响之后开始实验的学生，历史实验数据不会被修改。</span></div></div>
            ) : editing.status === '已发布' ? (
              <div className={styles.versionNotice}><ShieldCheck size={16} /><div><strong>实验已经发布，但尚无学生开始</strong><span>可以修改当前 V{editing.version}，修改将对之后开始实验的全部学生生效。</span></div></div>
            ) : null}

            <div className={styles.formGrid}>
              <label>实验名称<input name="name" defaultValue={editing.name} /></label>
              <label>所属课程<input value={editing.course} disabled /></label>
              <label>最大飞行高度（m）<input name="maxAltitude" type="number" min="1" max="500" defaultValue={editing.maxAltitude} /></label>
              <label>实验时长（min）<input name="duration" type="number" min="5" max="240" defaultValue={editing.duration} /></label>
            </div>

            <div className={styles.permissionChecks}>
              <label><input name="allowMissionEdit" type="checkbox" defaultChecked={editing.allowMissionEdit} /><span><strong>允许学生修改任务航点</strong><small>影响任务规划实验中的航点编辑能力</small></span></label>
              <label><input name="allowPidEdit" type="checkbox" defaultChecked={editing.allowPidEdit} /><span><strong>允许学生修改 PID 参数</strong><small>仅应在控制参数实验中开启</small></span></label>
            </div>

            <div className={styles.privacyBoundaryBox}><LockKeyhole size={15} /><div><strong>管理员数据边界</strong><span>本页仅允许修改实验定义。学生姓名、单次实验记录、飞行轨迹、遥测、实验报告和个人成绩均不会向管理员展示。</span></div></div>

            <div className={styles.formActions}><button className={styles.ghostButton} type="button" onClick={() => setEditingId(null)}>取消</button><button className={styles.primaryButton} type="submit">{editing.startedStudents > 0 ? `保存并生成 V${editing.version + 1}` : '保存修改'}</button></div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
