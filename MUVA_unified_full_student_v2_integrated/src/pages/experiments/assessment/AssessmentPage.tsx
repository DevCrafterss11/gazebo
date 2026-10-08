import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAssessmentStore } from '../../../stores/assessmentStore';
import { CognitionStep, ConfigurationStep, SceneStep, StartupStep } from './LearningSteps';
import { DiagnosticsStep, SafetyStep, TrainingStep, ResultStep } from './FlightSteps';
import styles from './AssessmentPage.module.css';

const names = ['系统认知', '飞行参数配置', '训练场景选择', '仿真环境启动', '飞控与传感器诊断', '起飞前安全检查', '综合飞行考核', '实验结果与复盘'];
export function AssessmentPage() {
  const run = useAssessmentStore((state) => state.run);
  const error = useAssessmentStore((state) => state.error);
  const hydrate = useAssessmentStore((state) => state.hydrate);
  const goTo = useAssessmentStore((state) => state.goTo);
  const advance = useAssessmentStore((state) => state.advance);
  const newRun = useAssessmentStore((state) => state.newRun);
  const restartTraining = useAssessmentStore((state) => state.restartTraining);
  const abort = useAssessmentStore((state) => state.abort);
  useEffect(() => hydrate(), [hydrate]);
  const panels = [<CognitionStep/>, <ConfigurationStep/>, <SceneStep/>, <StartupStep/>, <DiagnosticsStep/>, <SafetyStep/>, <TrainingStep/>, <ResultStep/>];
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><Link to="/experiments">← 实验中心</Link><h1>实验三：四旋翼无人机系统认知与综合飞行考核</h1><p>学习系统组成、完成前端模拟飞行并复盘评分。<strong className={styles.mockBadge}>● MOCK · 教学模拟 / 不连接真实飞控</strong></p></div>
      <div className={styles.headerActions}><span>Run {run.runId.slice(0, 8)} · {run.status}</span>{run.status === 'PAUSED' && run.environment === 'STOPPED' && <button onClick={restartTraining}>继续实验 · 重练模拟飞行</button>}<button onClick={() => { if (window.confirm('确定重新开始实验？将生成新的 Run ID。')) newRun(); }}>重新开始</button><button onClick={() => { if (window.confirm('结束当前实验？飞行中需要先安全降落。')) abort(); }}>结束实验</button></div>
      <nav className={styles.steps} aria-label="实验三步骤">{names.map((name, index) => <button className={index === run.step ? styles.active : ''} key={name} disabled={index > run.step} onClick={() => goTo(index)}><span>{run.completedSteps.includes(index) ? '✓' : String(index + 1)}</span>{name}</button>)}</nav>
    </header>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {panels[run.step]}
    <footer className={styles.footer}><span>教学提示：全部任务由当前模拟状态判定，命令接受不代表达标。</span><div><button disabled={run.step === 0} onClick={() => goTo(run.step - 1)}>← 上一步</button>{run.step < 7 && <button className={styles.primary} onClick={advance}>完成本阶段，进入下一步 →</button>}</div></footer>
  </main>;
}
