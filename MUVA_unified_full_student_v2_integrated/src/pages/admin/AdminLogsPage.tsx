import { ClipboardList, Search, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { adminApi } from '../../services/adminApi';
import type { AuditLogEntry, AuditResult } from '../../types/admin';
import styles from '../role/RolePages.module.css';

export function AdminLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [keyword, setKeyword] = useState('');
  const [module, setModule] = useState('all');
  const [result, setResult] = useState<AuditResult | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const response = await adminApi.listLogs();
        setLogs(response.items);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : '操作日志加载失败');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const modules = useMemo(() => Array.from(new Set(logs.map((item) => item.module))), [logs]);
  const filtered = useMemo(() => logs.filter((item) => {
    const text = `${item.account}${item.module}${item.action}${item.ip}`.toLowerCase();
    return (!keyword.trim() || text.includes(keyword.trim().toLowerCase()))
      && (module === 'all' || item.module === module)
      && (result === 'all' || item.result === result);
  }), [keyword, logs, module, result]);

  return (
    <section className={styles.rolePage}>
      <header className={styles.compactHeader}>
        <div><h1>操作日志</h1><p>审计账号、课程、实验配置和仿真资源关键操作。日志页只记录事件，不展示学生实验内容。</p></div>
        <span><ClipboardList size={14} /> 安全审计</span>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <label className={styles.search}><Search size={13} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索账号 / 事件 / IP" /></label>
          <select className={styles.filter} value={module} onChange={(event) => setModule(event.target.value)}><option value="all">全部模块</option>{modules.map((item) => <option key={item}>{item}</option>)}</select>
          <select className={styles.filter} value={result} onChange={(event) => setResult(event.target.value as AuditResult | 'all')}><option value="all">全部结果</option><option>成功</option><option>告警</option><option>失败</option></select>
        </div>
        <span className={styles.permissionBoundary}><ShieldCheck size={13} /> 关键修改建议后端保留 180 天以上</span>
      </div>

      {error ? <div className={styles.pageMessage}>{error}</div> : null}

      <section className={styles.panel}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><ClipboardList size={16} />审计事件</div><span className={styles.panelSubtle}>当前 {filtered.length} 条演示记录</span></div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.adminLogsV2}`}><span>时间</span><span>账号</span><span>模块</span><span>操作内容</span><span>来源 IP</span><span>结果</span></div>
          {loading ? <div className={styles.emptyHint}>正在加载审计日志…</div> : filtered.map((item) => (
            <div className={`${styles.tableRow} ${styles.adminLogsV2}`} key={item.id}>
              <span>{item.time}</span><strong>{item.account}</strong><span>{item.module}</span><span>{item.action}</span><span>{item.ip}</span><strong className={item.result === '成功' ? styles.successText : styles.dangerText}>{item.result}</strong>
            </div>
          ))}
          {!loading && filtered.length === 0 ? <div className={styles.emptyHint}>没有符合条件的操作日志</div> : null}
        </div>
      </section>
    </section>
  );
}
