import { ArrowRight, History, RadioTower, RotateCcw } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDialog } from '../../../../components/common/ConfirmDialog/ConfirmDialog';
import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { useExperimentStore } from '../../../../stores/experimentStore';
import styles from './ExperimentEntry.module.css';

export function ExperimentEntry() {
  const { experiment, savedProgress, scenes, isInitializing, initializationError, initialize, resumeExperiment, restartExperiment } = useExperimentStore();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  const savedStep = experiment.steps.find((step) => step.id === savedProgress?.currentStep);
  const savedScene = scenes.find((scene) => scene.id === savedProgress?.configuration.selectedSceneId);
  const disabled = isInitializing || pending || initializationError !== null;

  const enter = async (action: 'restart' | 'resume'): Promise<void> => {
    setConfirmingRestart(false);
    setPending(true);
    setError(null);
    try {
      if (action === 'resume') await resumeExperiment();
      else await restartExperiment();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : '进入实验失败，请重试');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={styles.entry}>
      <PanelShell title="实验介绍" icon={RadioTower} emphasis="primary">
        <div className={styles.content}>
          <h2>从系统认知到基础飞行</h2>
          <p>完成无人机系统学习、参数配置、环境与安全检查，再进行基础飞行训练和成绩复盘。</p>
          <ol className={styles.stages} aria-label="实验流程">
            {experiment.steps.map((step) => <li key={step.id}><span>{step.id}</span>{step.title}</li>)}
          </ol>
          {isInitializing && <p role="status">正在读取实验进度…</p>}
          {initializationError && <div className={styles.error} role="alert"><p>{initializationError}</p><button type="button" onClick={() => void initialize()}>重试读取进度</button></div>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          {savedProgress && <section className={styles.progress} aria-label="上次实验进度">
            <strong><History size={18} aria-hidden="true" />上次进度已保留</strong>
            <span>当前阶段：{savedStep?.title ?? '系统组成认知'} · 已完成 {savedProgress.completedSteps.length} 个步骤{savedScene ? ` · ${savedScene.name}` : ''}</span>
            <small>点击“继续上次进度”才恢复配置、学习记录和作答。重新加载后，飞行阶段需重新启动环境并完成安全检查。</small>
          </section>}
          <div className={styles.actions}>
            <button className={styles.primaryButton} type="button" disabled={disabled} onClick={() => savedProgress ? setConfirmingRestart(true) : void enter('restart')}>
              {savedProgress ? <RotateCcw size={18} aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
              {pending ? '正在进入实验…' : savedProgress ? '重新开始实验' : '开始新实验'}
            </button>
            {savedProgress && <button type="button" disabled={disabled} onClick={() => void enter('resume')}><History size={18} aria-hidden="true" />继续上次进度</button>}
          </div>
          <p className={styles.note}>重新开始将清空当前实验的配置、学习、检查和训练进度，从第一步开始；已保存的历史实验记录不会删除。</p>
        </div>
      </PanelShell>
      {confirmingRestart && <ConfirmDialog title="重新开始实验一" description="上次未完成的实验进度将被清空，无法再恢复。已保存的历史实验记录不会删除。确定从第一步重新开始吗？" confirmLabel="确认重新开始" onCancel={() => setConfirmingRestart(false)} onConfirm={() => enter('restart')} />}
    </div>
  );
}
