import { ChevronRight, FileText, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { EmptyState } from '../../components/common/EmptyState/EmptyState';
import { usePlatformUiStore } from '../../stores/platformUiStore';
import { useRecordsStore } from '../../stores/recordsStore';
import styles from './PlatformPages.module.css';

export function ReportsPage() {
  const records = useRecordsStore((state) => state.records);
  const showToast = usePlatformUiStore((state) => state.showToast);
  const [selectedRecordId, setSelectedRecordId] = useState('');

  useEffect(() => {
    if (!records.some((record) => record.id === selectedRecordId)) setSelectedRecordId(records[0]?.id ?? '');
  }, [records, selectedRecordId]);
  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? null;

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>实验报告</h1><p>报告内容与实验记录共用同一 Session、配置、任务、成绩和安全事件。</p></div>
        <span><FileText size={16} />{records.length} 份报告</span>
      </header>
      {records.length === 0 ? (
        <EmptyState icon={FileText} title="暂无实验报告" description="完成实验一后，平台会自动生成可查看的实验报告。" action={<Link to="/experiments/basic-flight">开始实验一</Link>} />
      ) : (
        <div className={styles.reportLayout}>
          <section className={styles.panel}>
            <h2><FileText size={18} />已完成实验</h2>
            <div className={styles.reportList}>
              {records.map((record) => (
                <button className={`${styles.reportItem} ${selectedRecordId === record.id ? styles.selectedReport : ''}`} type="button" aria-pressed={selectedRecordId === record.id} disabled={selectedRecordId === record.id} onClick={() => setSelectedRecordId(record.id)} key={record.id}>
                  <span><strong>{record.session.name}</strong><small>{record.id}</small></span>
                  <span><small>无人机</small><strong>{record.session.drone.name}</strong></span>
                  <span><small>场景</small><strong>{record.session.scene.name}</strong></span>
                  <span><small>完成时间</small><strong>{new Date(record.completedAt).toLocaleDateString('zh-CN')}</strong></span>
                  <span><small>得分</small><strong>{record.result.score}</strong></span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          </section>
          {selectedRecord ? (
            <section className={`${styles.panel} ${styles.reportViewer}`}>
              <div className={styles.reportHero}>
                <div><span>MUVA TRAINING REPORT</span><strong>{selectedRecord.session.name}</strong></div>
                <div className={styles.scoreBadge}>{selectedRecord.result.score}</div>
              </div>
              <dl className={styles.definitionList}>
                <div><dt>实验 ID</dt><dd>{selectedRecord.id}</dd></div>
                <div><dt>无人机型号</dt><dd>{selectedRecord.session.drone.name}</dd></div>
                <div><dt>飞控配置</dt><dd>{selectedRecord.session.configuration.flightController.firmware} · {selectedRecord.session.configuration.flightController.frameClass} {selectedRecord.session.configuration.flightController.frameType}</dd></div>
                <div><dt>实验场景</dt><dd>{selectedRecord.session.scene.name}</dd></div>
                <div><dt>实验任务</dt><dd>{selectedRecord.result.completedTasks} 完成 / {selectedRecord.result.failedTasks} 失败</dd></div>
                <div><dt>实验时间</dt><dd>{selectedRecord.result.durationSeconds}s</dd></div>
                <div><dt>训练成绩</dt><dd>{selectedRecord.result.score} / 100</dd></div>
                <div><dt>任务完成率</dt><dd>{selectedRecord.result.completionRate}%</dd></div>
                <div><dt>安全事件</dt><dd>{selectedRecord.events.length}</dd></div>
                <div><dt>时间线事件</dt><dd>{selectedRecord.eventTimeline?.length ?? 0}</dd></div>
                <div><dt>最大高度 / 速度</dt><dd>{selectedRecord.result.maxAltitude.toFixed(1)}m / {selectedRecord.result.maxSpeed.toFixed(1)}m/s</dd></div>
              </dl>
              <div className={styles.modalActions}>
                <Link className={styles.secondaryButton} to={`/records/${selectedRecord.id}`}>查看完整记录</Link>
                <button className={styles.primaryButton} type="button" onClick={() => { showToast('正在打开浏览器打印，可选择“另存为 PDF”。', 'success'); window.print(); }}><Printer size={15} />导出 / 打印 PDF</button>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
