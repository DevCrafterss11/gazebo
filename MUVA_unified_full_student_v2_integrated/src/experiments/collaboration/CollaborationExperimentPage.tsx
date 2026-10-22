import { useEffect } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleHelp, RotateCcw, Timer } from 'lucide-react';
import { Link } from 'react-router-dom';

import { useCollaborationStore } from '../../stores/collaborationStore';
import { CollaborationConfig } from './CollaborationConfig';
import { CollaborationExecution } from './CollaborationExecution';
import { DroneGroupConfig } from './DroneGroupConfig';
import { ExperimentReport } from './ExperimentReport';
import { FailureSimulation } from './FailureSimulation';
import { MissionIntroduction } from './MissionIntroduction';
import styles from './Collaboration.module.css';

const steps = ['实验任务认知', '无人机任务编组', '协同方案配置', '任务执行监控', '异常处理', '实验结果评价'];

export function CollaborationExperimentPage() {
  const currentStep = useCollaborationStore((state) => state.currentStep);
  const mission = useCollaborationStore((state) => state.missionState);
  const elapsedSeconds = useCollaborationStore((state) => state.elapsedSeconds);
  const setStep = useCollaborationStore((state) => state.setStep);
  const stop = useCollaborationStore((state) => state.stopExecution);
  const reset = useCollaborationStore((state) => state.reset);

  useEffect(() => () => stop(), [stop]);

  const content = [
    <MissionIntroduction key="introduction" mission={mission} onTaskSelect={setStepGroup} />,
    <DroneGroupConfig key="group" mission={mission} />,
    <CollaborationConfig key="config" mission={mission} />,
    <CollaborationExecution key="execution" />,
    <FailureSimulation key="failure" />,
    <ExperimentReport key="report" />,
  ][currentStep];

  function setStepGroup(groupId: string) {
    if (!groupId) return;
    useCollaborationStore.getState().selectTaskGroup(groupId);
    setStep(1);
  }

  return <div className={styles.page}><header className={styles.header}><div className={styles.headerTop}><Link to="/experiments" className={styles.backLink}><ArrowLeft size={15} />实验中心</Link><span className={styles.mockBadge}>● MOCK · 教学模拟 / 不连接真实飞控</span><div className={styles.headerActions}><span><Timer size={14} />{String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:{String(elapsedSeconds % 60).padStart(2, '0')}</span><button type="button" onClick={() => { if (window.confirm('确定重新开始实验？当前配置与模拟状态会清空。')) reset(); }}><RotateCcw size={14} />重新开始</button></div></div><div className={styles.titleRow}><div><span className={styles.kicker}>实验三 · 任务协同</span><h1>多无人机任务协同实验</h1><p>通过任务编组、角色分工和协同监控，理解无人机群如何完成综合区域巡检任务。</p></div><div className={styles.headerHelp}><CircleHelp size={16} /><span>本科教学 Mock 实验</span></div></div><nav className={styles.stepper} aria-label="实验三流程">{steps.map((step, index) => <button className={`${styles.step} ${index === currentStep ? styles.stepActive : ''} ${index < currentStep ? styles.stepDone : ''}`} key={step} type="button" onClick={() => setStep(index)}><span>{index < currentStep ? <Check size={14} /> : index + 1}</span><b>{step}</b>{index < steps.length - 1 && <i />}</button>)}</nav></header><main className={styles.content}>{content}</main><footer className={styles.footer}><span><b>教学目标：</b>{currentStep === 0 ? '认识综合区域巡检任务及五类协同关系。' : currentStep === 1 ? '为每个任务组配置三架合适的无人机。' : currentStep === 2 ? '比较同步、接力和主辅三种协同模式。' : currentStep === 3 ? '先观察任务组，再展开查看无人机状态。' : currentStep === 4 ? '识别异常影响范围并选择安全处置策略。' : '复盘任务完成率、时间、协同和异常处理表现。'}</span><div><button type="button" disabled={currentStep === 0} onClick={() => setStep(currentStep - 1)}><ArrowLeft size={15} />上一步</button>{currentStep < 5 && <button className={styles.primaryButton} type="button" onClick={() => setStep(currentStep + 1)}>完成本阶段，进入下一步<ArrowRight size={15} /></button>}</div></footer></div>;
}
