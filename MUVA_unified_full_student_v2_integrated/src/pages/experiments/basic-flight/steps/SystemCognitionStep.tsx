import { useEffect, useState } from 'react';

import { partLearning, parts, questions } from '../../../../domain/assessment/model';
import { useExperimentStore } from '../../../../stores/experimentStore';
import { FlightCanvas } from '../../assessment/FlightCanvas';
import { ConfigurationSummary } from '../components/ConfigurationSummary';
import { StepNavigation } from '../components/StepNavigation';
import styles from './SystemCognitionStep.module.css';

type Motion = 'roll' | 'pitch' | 'yaw' | 'throttle';

export function SystemCognitionStep() {
  const selectedDrone = useExperimentStore((state) => state.selectedDrone);
  const droneModels = useExperimentStore((state) => state.droneModels);
  const completedSteps = useExperimentStore((state) => state.completedSteps);
  const validationMessage = useExperimentStore((state) => state.validationMessage);
  const selectDrone = useExperimentStore((state) => state.selectDrone);
  const goToNextStep = useExperimentStore((state) => state.goToNextStep);
  const [selectedPart, setSelectedPart] = useState('frame');
  const [learnedParts, setLearnedParts] = useState<string[]>([]);
  const [motion, setMotion] = useState<Motion | null>(null);
  const [playing, setPlaying] = useState(true);
  const [focusPart, setFocusPart] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const iris = droneModels.find((drone) => drone.id === 'iris-quadrotor-01');

  useEffect(() => {
    if (iris && selectedDrone?.id !== iris.id) selectDrone(iris.id);
  }, [iris, selectedDrone?.id, selectDrone]);

  if (droneModels.length === 0) {
    return <div className={styles.loadingState}>正在加载 Iris 四旋翼教学模型...</div>;
  }

  const part = parts.find((item) => item.id === selectedPart) ?? parts[0]!;
  const learning = partLearning[part.id]!;
  const quizPassed = questions.every((question) => answers[question.id] === question.answer);
  const ready = Boolean(iris && selectedDrone?.id === iris.id && (completedSteps.includes(1) || learnedParts.length === parts.length && submitted));
  const choosePart = (id: string) => {
    setSelectedPart(id);
    setLearnedParts((current) => current.includes(id) ? current : [...current, id]);
  };

  return <div className={styles.page}>
    <section className={styles.panel}>
      <h2>✈ Iris 四旋翼 · 系统组成认知</h2>
      <div className={styles.canvas}><FlightCanvas cognition selectedPart={selectedPart} onPart={choosePart} demonstration={motion} demonstrationPlaying={playing} focusPart={focusPart}/><div className={styles.modelHint} role="status"><span>当前选中部件</span><strong>{part.name}</strong><small>点击模型部件或下方名称查看中文说明</small></div></div>
      <div className={styles.toolbar}><button onClick={() => setFocusPart(!focusPart)}>{focusPart ? '返回整体' : '局部放大'}</button><button onClick={() => { setFocusPart(false); setMotion(null); setPlaying(true); }}>重置视角</button></div>
      <div className={styles.partGrid}>{parts.map((item) => <button className={selectedPart === item.id ? styles.selected : ''} onClick={() => choosePart(item.id)} key={item.id}>{learnedParts.includes(item.id) ? '✓ ' : '○ '}{item.name}</button>)}</div>
      <p>已学习 {learnedParts.length} / {parts.length} · 点击 3D 机体或部件了解结构</p>
    </section>

    <section className={styles.panel}>
      <h2>控制链路与飞行原理</h2>
      <div className={styles.controlFlow}>{['学生操作 / 目标指令', '飞控控制器', '电机输出', '无人机姿态与运动', '传感器测量 IMU / GPS', '状态估计 EKF → 反馈控制'].map((name, index) => <div className={styles.flowNode} key={name}><b>{String(index + 1).padStart(2, '0')}</b>{name}</div>)}</div>
      <h3>四旋翼基本运动原理</h3>
      <div className={styles.motionGrid}>{(['roll', 'pitch', 'yaw', 'throttle'] as const).map((axis) => <button className={motion === axis ? styles.selected : ''} key={axis} onClick={() => { setMotion(axis); setPlaying(true); }}><strong>{axis.toUpperCase()}</strong><small>{({ roll: '绕机头前后轴横滚', pitch: '绕左右轴俯仰', yaw: '绕竖直轴改变航向', throttle: '四电机同时增速，上升' })[axis]}</small></button>)}</div>
      <div className={styles.toolbar}><button disabled={!motion} onClick={() => setPlaying(!playing)}>{playing ? '暂停动画' : '继续动画'}</button><button onClick={() => { setMotion(null); setPlaying(true); }}>重置动画</button></div>
      <div className={styles.partDetail} aria-live="polite"><span>当前部件 · {part.name}</span><strong>{part.role}</strong><p>{part.principle}</p></div>
      <div className={styles.learning}><p><strong>连接关系</strong>{learning.connection}</p><p><strong>控制影响</strong>{learning.control}</p><p><strong>常见异常</strong>{learning.fault}</p></div>
    </section>

    <section className={styles.panel}>
      <h2>学习目标与知识自测</h2>
      <p>① 认识八个核心部件及用途<br/>② 理解飞控—电调—电机的闭环控制<br/>③ 掌握 Roll / Pitch / Yaw / Throttle</p>
      <div className={styles.quiz}>{questions.map((question) => <label key={question.id}>{question.question}<select value={answers[question.id] ?? ''} onChange={(event) => { setAnswers((current) => ({ ...current, [question.id]: event.target.value })); setSubmitted(false); }}><option value="">请选择</option>{question.choices.map((choice) => <option key={choice}>{choice}</option>)}</select>{submitted && <small>{answers[question.id] === question.answer ? '✓ 正确' : `错误 · ${question.explanation}`}</small>}</label>)}</div>
      <button onClick={() => setSubmitted(true)} disabled={questions.some((question) => !answers[question.id])}>提交自测</button>
      {submitted && <p role="status">{quizPassed ? '✓ 知识自测全部答对' : '已记录自测结果，请参考错题解析复习；不影响进入下一步。'}</p>}
      <h3>实验配置摘要</h3><ConfigurationSummary/>
      <div className={styles.stepActions}><StepNavigation canGoBack={false} canGoNext={ready} nextLabel="下一步：实验参数配置" onBack={() => undefined} onNext={() => void goToNextStep()}/></div>
      <p role="status">{validationMessage ?? (!iris ? '当前无人机资源中缺少 Iris 四旋翼，无法继续。' : ready ? '✓ 系统认知已完成，可以继续。' : learnedParts.length < parts.length ? `还需学习 ${parts.length - learnedParts.length} 个部件。` : !submitted ? '部件学习已完成，请回答并提交知识自测。' : '正在准备进入下一步。')}</p>
    </section>
  </div>;
}
