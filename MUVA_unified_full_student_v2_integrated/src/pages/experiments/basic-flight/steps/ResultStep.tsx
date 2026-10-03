import { FileDown, RotateCcw, Trophy } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ConfirmDialog } from '../../../../components/common/ConfirmDialog/ConfirmDialog';
import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { useExperimentStore } from '../../../../stores/experimentStore';
import { usePlatformUiStore } from '../../../../stores/platformUiStore';
import styles from '../components/WorkflowSteps.module.css';

export function ResultStep() {
  const result = useExperimentStore((state) => state.result);
  const restartExperiment = useExperimentStore((state) => state.restartExperiment);
  const showToast = usePlatformUiStore((state) => state.showToast);
  const navigate = useNavigate();
  const [confirmingRestart, setConfirmingRestart] = useState(false);

  if (!result) {
    return (
      <div className={styles.resultPage}>
        <PanelShell title="实验结果" icon={Trophy}>
          <div className={styles.resultContent}>
            <h2>尚未生成实验结果</h2>
            <p>完成基础飞行训练后，评分、遥测与报告会显示在这里。</p>
            <div className={styles.resultActions}>
              <button type="button" onClick={() => setConfirmingRestart(true)}>重新开始实验一</button>
              <button type="button" onClick={() => navigate('/experiments')}>返回实验中心</button>
            </div>
          </div>
        </PanelShell>
        {confirmingRestart ? (
          <ConfirmDialog title="重新开始实验一" description="当前实验配置、检查进度和飞行数据将被重置。" onCancel={() => setConfirmingRestart(false)} onConfirm={async () => { setConfirmingRestart(false); await restartExperiment(); }} confirmLabel="确认重置" />
        ) : null}
      </div>
    );
  }

  return (
    <div className={styles.resultPage}>
      <PanelShell title="实验结果" icon={Trophy} action={<span>训练报告</span>}>
        <div className={styles.resultContent}>
          <div className={styles.resultScore}><strong>{result.score}</strong><span>/ 100</span></div>
          <h2>基础飞行训练已完成</h2>
          <div className={styles.resultMetrics}>
            <span>无人机<strong>{result.droneName}</strong></span>
            <span>场景<strong>{result.sceneName}</strong></span>
            <span>实验时间<strong>{result.durationSeconds}s</strong></span>
            <span>完成任务<strong>{result.completedTasks}/10</strong></span>
            <span>最大高度<strong>{result.maxAltitude.toFixed(1)}m</strong></span>
            <span>最大速度<strong>{result.maxSpeed.toFixed(1)}m/s</strong></span>
            <span>悬停误差<strong>{result.averageAltitudeError.toFixed(2)}m</strong></span>
            <span>安全事件<strong>{result.safetyEvents.length}</strong></span>
          </div>
          <div className={styles.resultActions}>
            <button type="button" onClick={() => setConfirmingRestart(true)}><RotateCcw size={17} />重新实验</button>
            <button type="button" onClick={() => { showToast('正在打开浏览器打印，可选择“另存为 PDF”。', 'success'); window.print(); }}><FileDown size={17} />导出报告</button>
            <button type="button" onClick={() => navigate('/experiments')}>返回实验中心</button>
          </div>
        </div>
        {confirmingRestart ? (
          <ConfirmDialog title="重新开始实验一" description="当前实验配置、检查进度和飞行数据将被重置。" onCancel={() => setConfirmingRestart(false)} onConfirm={async () => { setConfirmingRestart(false); await restartExperiment(); }} confirmLabel="确认重置" />
        ) : null}
      </PanelShell>
    </div>
  );
}
