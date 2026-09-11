import { ArrowLeft, ChartNoAxesCombined, ClipboardCheck, ListChecks, Map, RadioTower, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';

import { TelemetryChartSlot } from '../../components/charts/TelemetryChartSlot';
import { EmptyState } from '../../components/common/EmptyState/EmptyState';
import { useRecordsStore } from '../../stores/recordsStore';
import { createTelemetryChartOptions } from './telemetryChartOptions';
import styles from './PlatformPages.module.css';

export function RecordDetailPage() {
  const { id = '' } = useParams();
  const record = useRecordsStore((state) => state.currentRecord);
  const isLoading = useRecordsStore((state) => state.isLoading);
  const error = useRecordsStore((state) => state.error);
  const loadRecord = useRecordsStore((state) => state.loadRecord);

  useEffect(() => { void loadRecord(id); }, [id, loadRecord]);
  const charts = useMemo(() => createTelemetryChartOptions(record?.telemetryHistory ?? []), [record]);

  if (isLoading) return <div className={styles.page}><section className={styles.panel}>正在读取实验记录...</section></div>;
  if (!record || error) {
    return <div className={styles.page}><EmptyState icon={ClipboardCheck} title="未找到实验记录" description={error ?? `记录 ${id} 不存在或已被清理。`} action={<Link to="/records">返回实验记录</Link>} /></div>;
  }

  const { session, result, telemetryHistory, tasks, events } = record;
  const controller = session.configuration.flightController;
  const parameters = session.configuration.flightParameters;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>实验记录详情</h1><p>{record.id} · {session.name}</p></div>
        <Link className={styles.secondaryButton} to="/records"><ArrowLeft size={15} />返回记录列表</Link>
      </header>
      <div className={styles.detailGrid}>
        <section className={styles.panel}>
          <h2><ClipboardCheck size={18} />实验配置</h2>
          <dl className={styles.definitionList}>
            <div><dt>无人机</dt><dd>{session.drone.name}</dd></div>
            <div><dt>场景</dt><dd>{session.scene.name}</dd></div>
            <div><dt>飞控</dt><dd>{controller.autopilot} · {controller.firmware}</dd></div>
            <div><dt>构型</dt><dd>{controller.frameClass} {controller.frameType}</dd></div>
            <div><dt>飞行模式</dt><dd>{controller.flightMode}</dd></div>
            <div><dt>起飞 / 最大高度</dt><dd>{parameters.takeoffAltitude}m / {parameters.maxAltitude}m</dd></div>
          </dl>
        </section>
        <section className={styles.panel}>
          <h2><RadioTower size={18} />评分与关键指标</h2>
          <dl className={styles.definitionList}>
            <div><dt>训练成绩</dt><dd>{result.score} / 100</dd></div>
            <div><dt>完成率</dt><dd>{result.completionRate}%</dd></div>
            <div><dt>实验时间</dt><dd>{result.durationSeconds}s</dd></div>
            <div><dt>最大高度</dt><dd>{result.maxAltitude.toFixed(1)}m</dd></div>
            <div><dt>最大速度</dt><dd>{result.maxSpeed.toFixed(1)}m/s</dd></div>
            <div><dt>高度误差</dt><dd>{result.averageAltitudeError.toFixed(2)}m</dd></div>
          </dl>
        </section>
        <section className={`${styles.panel} ${styles.widePanel}`}>
          <h2><ListChecks size={18} />实验任务</h2>
          <div className={styles.taskChips}>{tasks.map((task) => <span className={task.status === 'COMPLETED' ? styles.done : ''} key={task.id}>{task.id}. {task.title} · {task.status}</span>)}</div>
        </section>
        <section className={`${styles.panel} ${styles.widePanel}`}>
          <h2><ShieldAlert size={18} />事件</h2>
          <div className={styles.eventList}>{events.length > 0 ? events.map((event) => <span key={event}>{event}</span>) : <span>实验过程中未记录到安全事件。</span>}</div>
        </section>
        <section className={`${styles.panel} ${styles.widePanel} ${styles.chartPanel}`}>
          <h2><ChartNoAxesCombined size={18} />遥测与飞行轨迹 · {telemetryHistory.length} 个采样点</h2>
          <div className={styles.chartsGrid}>
            <div className={styles.chartCard}><TelemetryChartSlot title="高度" metric={`${result.maxAltitude.toFixed(1)}m`} option={charts.altitude} /></div>
            <div className={styles.chartCard}><TelemetryChartSlot title="速度" metric={`${result.maxSpeed.toFixed(1)}m/s`} option={charts.speed} /></div>
            <div className={styles.chartCard}><TelemetryChartSlot title="Roll / Pitch / Yaw" metric="姿态" option={charts.attitude} /></div>
            <div className={styles.chartCard}><TelemetryChartSlot title="飞行轨迹" metric="East / North" option={charts.trajectory} /></div>
          </div>
        </section>
        <section className={`${styles.panel} ${styles.widePanel}`}>
          <h2><Map size={18} />位置摘要</h2>
          <dl className={styles.definitionList}>
            <div><dt>Home Point</dt><dd>{session.scene.latitude.toFixed(6)}, {session.scene.longitude.toFixed(6)}</dd></div>
            <div><dt>完成时间</dt><dd>{new Date(record.completedAt).toLocaleString('zh-CN', { hour12: false })}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}
