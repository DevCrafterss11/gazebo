import { ChevronRight, ClipboardList, Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';

import { EmptyState } from '../../components/common/EmptyState/EmptyState';
import { useRecordsStore } from '../../stores/recordsStore';
import { savedSwarmRecords } from '../../stores/swarmStore';
import { listAssessmentRecords } from '../../stores/assessmentStore';
import styles from './PlatformPages.module.css';

const formatDateTime = (timestamp: string): string => new Date(timestamp).toLocaleString('zh-CN', { hour12: false });

export function RecordsPage() {
  const records = useRecordsStore((state) => state.records);
  const isLoading = useRecordsStore((state) => state.isLoading);
  const error = useRecordsStore((state) => state.error);
  const swarmRecords = savedSwarmRecords();
  const assessmentRecords = listAssessmentRecords();

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>实验记录</h1><p>已完成实验的配置、任务、评分、遥测、事件与飞行轨迹均保存在同一条 Session 记录中。</p></div>
        <span><ClipboardList size={16} />{records.length} 条记录</span>
      </header>
      {error ? <section className={styles.panel} role="alert">{error}</section> : null}
      {swarmRecords.length > 0 ? <section className={styles.panel}><h2>实验二 · 多无人机集群区域规划与协同飞行</h2>{swarmRecords.map((record) => <div key={record.runId}><Link to={`/records/swarm/${record.runId}`}><strong>{record.runId}</strong> · {formatDateTime(record.completedAt)} · {record.status} · {record.score} 分 · 覆盖率 {record.coverage.toFixed(1)}% · 查看报告</Link></div>)}</section> : null}
      {assessmentRecords.length > 0 ? <section className={styles.panel}><h2>实验三 · 四旋翼综合飞行考核</h2>{assessmentRecords.map((record) => <div key={record.runId}><Link to={`/records/assessment/${record.runId}`}><strong>{record.runId}</strong> · {new Date(record.completedAt ?? record.startedAt).toLocaleString()} · {record.overallScore === undefined ? '综合成绩待结算' : `综合 ${record.overallScore} 分 · 实操 ${record.practiceScore} · 理论 ${record.theoryScore}`} · 查看独立报告</Link></div>)}</section> : null}
      {isLoading && records.length === 0 ? <section className={styles.panel}>正在加载本地实验记录...</section> : null}
      {!isLoading && records.length === 0 && swarmRecords.length === 0 && assessmentRecords.length === 0 ? (
        <EmptyState icon={ClipboardList} title="暂无实验记录" description="完成一次基础飞行训练后，实验配置、成绩和遥测历史会自动保存在这里。" action={<Link to="/experiments/basic-flight">开始实验一</Link>} />
      ) : records.length > 0 ? (
        <section className={`${styles.panel} ${styles.tablePanel}`}>
          <div className={styles.tableHeader}><span>实验 ID / 名称</span><span>无人机</span><span>场景</span><span>时间</span><span>状态 / 得分</span><span /></div>
          <div className={styles.tableBody}>
            {records.map((record) => (
              <Link className={styles.recordItem} to={`/records/${record.id}`} key={record.id}>
                <span><strong>{record.session.name}</strong><small>{record.id}</small></span>
                <span><small>无人机</small><strong>{record.session.drone.name}</strong></span>
                <span><small>场景</small><strong>{record.session.scene.name}</strong></span>
                <span><small><Clock3 size={10} /> 完成时间</small><strong>{formatDateTime(record.completedAt)}</strong></span>
                <span><small>{record.session.status}</small><strong>{record.result.score} 分</strong></span>
                <ChevronRight size={16} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
