import { Cpu, RefreshCw, RotateCcw, Search, Server, Square } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { adminApi } from '../../services/adminApi';
import type { ResourceStatus, SimulationResource } from '../../types/admin';
import styles from '../role/RolePages.module.css';

const statusClass = (status: ResourceStatus) => {
  if (status === 'RUNNING') return styles.successText;
  if (status === 'WARNING') return styles.dangerText;
  return '';
};

export function AdminResourcesPage() {
  const [resources, setResources] = useState<SimulationResource[]>([]);
  const [keyword, setKeyword] = useState('');
  const [node, setNode] = useState('all');
  const [status, setStatus] = useState<ResourceStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const result = await adminApi.listResources();
      setResources(result.items);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '仿真资源加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const nodes = useMemo(() => Array.from(new Set(resources.map((item) => item.node))), [resources]);
  const filtered = useMemo(() => resources.filter((item) => {
    const text = `${item.id}${item.ownerAccount}${item.experimentName}${item.runtime}`.toLowerCase();
    return (!keyword.trim() || text.includes(keyword.trim().toLowerCase()))
      && (node === 'all' || item.node === node)
      && (status === 'all' || item.status === status);
  }), [keyword, node, resources, status]);

  const summary = useMemo(() => ({
    running: resources.filter((item) => item.status === 'RUNNING').length,
    idle: resources.filter((item) => item.status === 'IDLE').length,
    warning: resources.filter((item) => item.status === 'WARNING').length,
    avgCpu: resources.length ? Math.round(resources.reduce((sum, item) => sum + item.cpu, 0) / resources.length) : 0,
  }), [resources]);

  const mutateResource = async (resource: SimulationResource, action: 'restart' | 'stop') => {
    setActingId(resource.id);
    try {
      const updated = action === 'restart' ? await adminApi.restartResource(resource.id) : await adminApi.stopResource(resource.id);
      setResources((items) => items.map((item) => item.id === updated.id ? updated : item));
      setError('');
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : '资源操作失败');
    } finally {
      setActingId(null);
    }
  };

  return (
    <section className={styles.rolePage}>
      <header className={styles.compactHeader}>
        <div><h1>仿真资源</h1><p>维护 Gazebo、ArduPilot SITL 与运行实例。这里管理的是计算资源，不提供学生实验记录入口。</p></div>
        <span><Server size={14} /> 仿真实例调度</span>
      </header>

      <section className={`${styles.panel} ${styles.adminSummaryPanel}`}>
        <div className={styles.miniSummaryGrid}>
          <div><span>运行实例</span><strong>{summary.running}</strong><small>正在占用 Gazebo / SITL 资源</small></div>
          <div><span>空闲实例</span><strong>{summary.idle}</strong><small>可立即分配给新的实验会话</small></div>
          <div><span>异常实例</span><strong className={summary.warning ? styles.warningMetric : ''}>{summary.warning}</strong><small>需要管理员关注资源状态</small></div>
          <div><span>平均 CPU</span><strong>{summary.avgCpu}%</strong><small>演示数据，后续接监控 API</small></div>
        </div>
      </section>

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <label className={styles.search}><Search size={13} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索实例 / 账号 / 实验" /></label>
          <select className={styles.filter} value={node} onChange={(event) => setNode(event.target.value)}><option value="all">全部节点</option>{nodes.map((item) => <option key={item}>{item}</option>)}</select>
          <select className={styles.filter} value={status} onChange={(event) => setStatus(event.target.value as ResourceStatus | 'all')}><option value="all">全部状态</option><option>RUNNING</option><option>IDLE</option><option>WARNING</option><option>STOPPED</option></select>
        </div>
        <button className={styles.ghostButton} type="button" onClick={() => void load()}><RefreshCw size={14} />刷新状态</button>
      </div>

      {error ? <div className={styles.pageMessage}>{error}</div> : null}

      <section className={styles.panel}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><Cpu size={16} />实例列表</div><span className={styles.panelSubtle}>预留资源控制 API，当前操作只作用于前端 Mock 状态</span></div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.adminResourcesV2}`}><span>实例</span><span>节点</span><span>使用账号</span><span>实验 / 环境</span><span>资源</span><span>状态</span><span>操作</span></div>
          {loading ? <div className={styles.emptyHint}>正在同步仿真资源状态…</div> : filtered.map((item) => (
            <div className={`${styles.tableRow} ${styles.adminResourcesV2}`} key={item.id}>
              <div className={styles.identityCopy}><strong>{item.id}</strong><span>{item.startedAt ? `启动 ${item.startedAt}` : '当前未分配'}</span></div>
              <span>{item.node}</span>
              <span>{item.ownerAccount}</span>
              <div className={styles.identityCopy}><strong>{item.experimentName}</strong><span>{item.runtime}</span></div>
              <span>CPU {item.cpu}% · MEM {item.memory}%</span>
              <strong className={statusClass(item.status)}>{item.status}</strong>
              <div className={styles.rowActions}>
                <button className={styles.iconAction} title="重启实例" type="button" disabled={actingId === item.id} onClick={() => void mutateResource(item, 'restart')}><RotateCcw size={13} /></button>
                <button className={`${styles.iconAction} ${styles.iconDanger}`} title="停止并释放" type="button" disabled={actingId === item.id || item.status === 'IDLE'} onClick={() => void mutateResource(item, 'stop')}><Square size={12} /></button>
              </div>
            </div>
          ))}
          {!loading && filtered.length === 0 ? <div className={styles.emptyHint}>没有符合条件的仿真实例</div> : null}
        </div>
      </section>
    </section>
  );
}
