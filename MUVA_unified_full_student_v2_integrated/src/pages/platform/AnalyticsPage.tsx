import { BarChart3, ChartNoAxesCombined } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { TelemetryChartSlot } from '../../components/charts/TelemetryChartSlot';
import { EmptyState } from '../../components/common/EmptyState/EmptyState';
import { useRecordsStore } from '../../stores/recordsStore';
import { createTelemetryChartOptions } from './telemetryChartOptions';
import styles from './PlatformPages.module.css';

export function AnalyticsPage() {
  const records = useRecordsStore((state) => state.records);
  const [selectedRecordId, setSelectedRecordId] = useState('');

  useEffect(() => {
    if (!records.some((record) => record.id === selectedRecordId)) setSelectedRecordId(records[0]?.id ?? '');
  }, [records, selectedRecordId]);

  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? null;
  const samples = selectedRecord?.telemetryHistory ?? [];
  const charts = useMemo(() => createTelemetryChartOptions(samples), [samples]);
  const latest = samples.at(-1);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>数据分析</h1><p>图表仅使用已保存实验记录中的 telemetryHistory，不生成独立随机数据。</p></div>
        <span><BarChart3 size={16} />实验遥测分析</span>
      </header>
      {records.length === 0 ? (
        <EmptyState icon={ChartNoAxesCombined} title="暂无实验数据" description="完成实验一后，即可选择实验记录分析高度、速度、姿态、电池和 GPS 数据。" action={<Link to="/experiments/basic-flight">开始实验</Link>} />
      ) : selectedRecord ? (
        <>
          <section className={styles.panel}>
            <div className={styles.selectRow}>
              <label htmlFor="analytics-record">选择实验记录</label>
              <select id="analytics-record" value={selectedRecordId} onChange={(event) => setSelectedRecordId(event.target.value)}>
                {records.map((record) => <option value={record.id} key={record.id}>{record.session.name} · {new Date(record.completedAt).toLocaleString('zh-CN', { hour12: false })}</option>)}
              </select>
            </div>
          </section>
          <div className={styles.chartsGrid}>
            <div className={styles.chartCard}><TelemetryChartSlot title="高度 (m)" metric={latest?.position.altitude.toFixed(1) ?? '--'} option={charts.altitude} /></div>
            <div className={styles.chartCard}><TelemetryChartSlot title="速度 (m/s)" metric={latest?.speedMetersPerSecond.toFixed(1) ?? '--'} option={charts.speed} /></div>
            <div className={styles.chartCard}><TelemetryChartSlot title="Roll / Pitch / Yaw" metric="姿态角" option={charts.attitude} /></div>
            <div className={styles.chartCard}><TelemetryChartSlot title="Battery (%)" metric={`${latest?.batteryPercent.toFixed(0) ?? '--'}%`} option={charts.battery} /></div>
            <div className={styles.chartCard}><TelemetryChartSlot title="GPS 卫星数" metric={`${latest?.gpsSatellites ?? '--'}`} option={charts.gps} /></div>
            <div className={styles.chartCard}><TelemetryChartSlot title="飞行轨迹" metric={`${samples.length} samples`} option={charts.trajectory} /></div>
          </div>
        </>
      ) : null}
    </div>
  );
}
