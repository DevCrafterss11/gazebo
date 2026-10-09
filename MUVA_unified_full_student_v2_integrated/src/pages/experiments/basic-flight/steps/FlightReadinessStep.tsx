import { useState } from 'react';
import { Activity, Check, CircleAlert, ClipboardCheck, Compass, Home, MapPinned, Radar, ShieldCheck } from 'lucide-react';

import { useEnvironmentStore } from '../../../../stores/environmentStore';
import { useExperimentStore } from '../../../../stores/experimentStore';
import { useFlightStore } from '../../../../stores/flightStore';
import { useTelemetryStore } from '../../../../stores/telemetryStore';
import type { SensorCheckItem } from '../../../../types/configuration';
import { StepNavigation } from '../components/StepNavigation';
import styles from './FlightReadinessStep.module.css';

const sensorNames: Record<SensorCheckItem['id'], { title: string; impact: string }> = {
  heartbeat: { title: '心跳 / 通信', impact: '链路中断时禁止起飞' },
  gps: { title: 'GPS 定位', impact: '影响定位与返航' },
  imu: { title: 'IMU 惯导', impact: '影响姿态稳定性' },
  compass: { title: '指南针', impact: '影响航向判断' },
  barometer: { title: '气压计', impact: '影响高度估计' },
  ekf: { title: 'EKF 状态估计', impact: '影响导航可信度' },
};

const checklistNames: Record<string, string> = {
  'environment-ready': '仿真环境 READY', 'sitl-connected': 'SITL 已连接', 'mavlink-connected': 'MAVLink 已连接',
  heartbeat: '心跳正常', gps: 'GPS 3D 定位', ekf: 'EKF 正常', imu: 'IMU 正常',
  compass: '指南针正常', barometer: '气压计正常', home: 'Home 已设置',
  parameters: '飞行参数有效', 'vehicle-disarmed': '机体未解锁',
};

const diagnosticQuestions = [
  { id: 'gps', title: '定位不足', observation: 'GPS 卫星不足，无法形成稳定的三维定位。', question: '准备起飞时，应采取什么操作？', choices: [{ id: 'wait', label: '暂停起飞，检查环境并等待定位恢复后复检' }, { id: 'fly', label: '忽略定位状态，立即起飞' }, { id: 'speed', label: '提高速度以改善定位' }], correct: 'wait', reason: '位置与返航依赖可靠定位，定位异常不能通过提高速度解决。' },
  { id: 'ekf', title: '状态估计异常', observation: 'IMU 有读数，但 EKF 状态显示异常。', question: '此时应如何判断？', choices: [{ id: 'ignore', label: '只要 IMU 有读数就可以起飞' }, { id: 'calibrate', label: '暂停起飞，排查惯导与状态估计并重新检查' }, { id: 'disable', label: '关闭状态估计继续飞行' }], correct: 'calibrate', reason: '有原始传感器数据不等于状态估计可信，必须先排查异常。' },
  { id: 'heartbeat', title: '通信心跳丢失', observation: '飞控心跳中断，其他传感器仍显示正常。', question: '最安全的起飞决策是什么？', choices: [{ id: 'takeoff', label: '传感器正常即可起飞' }, { id: 'skip', label: '跳过通信检查继续任务' }, { id: 'restore', label: '禁止解锁，先恢复链路并重新检查心跳' }], correct: 'restore', reason: '心跳中断意味着无法可靠确认飞控连接；不能跳过通信检查。' },
] as const;

function DiagnosticQuiz() {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const answered = diagnosticQuestions.filter((question) => answers[question.id]).length;
  const correct = diagnosticQuestions.filter((question) => answers[question.id] === question.correct).length;
  return <section className={`${styles.panel} ${styles.quiz}`} aria-label="飞控诊断自测">
    <div className={styles.quizHeader}><div><h2><ShieldCheck size={18} /> 飞控诊断自测 · 学习检查</h2><p>先观察检查读数，再完成三种异常情境判断；自测不注入故障，也不替代实际传感器检查。</p></div><span>{submitted ? `答对 ${correct} / ${diagnosticQuestions.length}` : `已答 ${answered} / ${diagnosticQuestions.length}`}</span></div>
    <div className={styles.quizCards}>{diagnosticQuestions.map((question, index) => <div className={styles.quizCard} key={question.id}>
      <div className={styles.quizTitle}><span>0{index + 1} · {question.title}</span>{submitted && <b className={answers[question.id] === question.correct ? styles.pass : styles.fail}>{answers[question.id] === question.correct ? '判断正确' : '需要复习'}</b>}</div>
      <p>{question.observation}</p><strong>{question.question}</strong>
      <div className={styles.quizChoices}>{question.choices.map((choice) => <label className={answers[question.id] === choice.id ? styles.choiceSelected : ''} key={choice.id}><input type="radio" name={`diagnosis-${question.id}`} checked={answers[question.id] === choice.id} onChange={() => { setAnswers((previous) => ({ ...previous, [question.id]: choice.id })); setSubmitted(false); }} />{choice.label}</label>)}</div>
      {submitted && <p className={styles.quizReason}>{question.reason}</p>}
    </div>)}</div>
    <div className={styles.quizFooter}><span>教学自测不计入实验一飞行成绩；通过步骤仍以系统检查结果为准。</span><button type="button" disabled={answered !== diagnosticQuestions.length} onClick={() => setSubmitted(true)}>{submitted ? '已查看解析' : '提交自测 · 查看解析'}</button></div>
  </section>;
}

function SceneOverview({ sceneId, sceneName }: { sceneId: string | null; sceneName: string | null }) {
  const home = useExperimentStore((state) => state.configuration.homePosition);
  const image = ['campus', 'city', 'mountain', 'airport'].includes(sceneId ?? '') ? `/experiment3/scenes/${sceneId}-satellite.jpg` : null;
  return <section className={styles.panel}>
    <h2><MapPinned size={18} /> 模拟起飞区 · {sceneName ?? '未选择场景'}</h2>
    <div className={styles.map}>
      {image && <img src={image} alt={`${sceneName}教学卫星影像`} />}
      <span className={styles.boundary} aria-label="安全范围示意" />
      <span className={styles.target}><MapPinned size={15} /> 目标点 · 示意</span>
      <span className={styles.drone} aria-label="四旋翼起飞点"><svg viewBox="0 0 80 80" aria-hidden="true"><path d="M20 20 60 60 M60 20 20 60" stroke="#c4faff" strokeWidth="4"/><g fill="#07344d" stroke="#71e9ff" strokeWidth="2"><circle cx="18" cy="18" r="9"/><circle cx="62" cy="18" r="9"/><circle cx="18" cy="62" r="9"/><circle cx="62" cy="62" r="9"/></g><path d="M40 17 50 40 46 53 34 53 30 40Z" fill="#2bd3ef"/><path d="M40 16 35 27 45 27Z" fill="#fff2a2"/></svg></span>
      <span className={styles.home}><Home size={15} /> Home</span>
      <span className={styles.north}><Compass size={16} /> N</span>
    </div>
    <p className={styles.caption}>Home {home ? `${home.latitude.toFixed(5)}°, ${home.longitude.toFixed(5)}° · ${home.altitude} m` : '未设置'} · 影像与坐标未配准，仅作教学示意。</p>
  </section>;
}

function Diagnostics() {
  const sensors = useExperimentStore((state) => state.configuration.sensors);
  const systemCheckStatus = useExperimentStore((state) => state.systemCheckStatus);
  const isCheckingSensors = useExperimentStore((state) => state.isCheckingSensors);
  const runSensorCheck = useExperimentStore((state) => state.runSensorCheck);
  const environmentReady = useEnvironmentStore((state) => state.startup.phase === 'READY');
  const latest = useTelemetryStore((state) => state.latest);
  const passed = sensors.filter((sensor) => sensor.status === 'PASS').length;
  return <>
    <section className={styles.panel}>
      <h2><Radar size={18} /> 模拟飞控健康检查</h2>
      <p>对照检查结果识别异常。仅检测状态，不执行硬件校准。</p>
      <div className={styles.list}>{sensors.map((sensor) => <div className={styles.row} key={sensor.id}>
        <div><strong>{sensorNames[sensor.id].title}</strong><small>{sensor.details.join(' · ')} · {sensorNames[sensor.id].impact}</small></div>
        <b className={sensor.status === 'PASS' ? styles.pass : sensor.status === 'FAIL' ? styles.fail : styles.wait}>{sensor.status === 'PASS' ? '通过' : sensor.status === 'FAIL' ? '异常' : sensor.status === 'CHECKING' ? '检查中' : '待检测'}</b>
      </div>)}</div>
      <button className={styles.primary} type="button" disabled={isCheckingSensors || !environmentReady} onClick={() => void runSensorCheck()}>{isCheckingSensors ? '正在检查传感器…' : systemCheckStatus === 'PASSED' ? '重新执行健康检查' : '开始健康检查'}</button>
      <p className={styles.note}>检查结果由实验一的环境与传感器服务返回，教学情境不会改变真实检查结果。</p>
      <div className={styles.readingGuide}><strong>检查结果怎么用？</strong><span>先看通信与定位，再看姿态和高度，最后确认 EKF 状态估计。任何异常都应排查并复检，而不是跳过该项。</span></div>
    </section>
    <section className={styles.panel}>
      <h2><Activity size={18} /> 飞控状态与情境判断</h2>
      <div className={styles.metrics}>
        <div><span>传感器</span><strong>{passed}/{sensors.length}</strong></div>
        <div><span>GPS 卫星</span><strong>{latest?.gpsSatellites ?? '--'}</strong></div>
        <div><span>EKF</span><strong>{latest ? latest.ekfStatus.healthy ? '正常' : '异常' : '--'}</strong></div>
        <div><span>通信心跳</span><strong>{latest ? latest.mavlinkStatus.heartbeat ? '在线' : '中断' : '--'}</strong></div>
      </div>
      <div className={styles.statusGuide}><strong>健康检查如何判读？</strong><p>先确认心跳与定位，再观察 IMU、指南针、气压计和 EKF。任一关键项失败时，暂停起飞并重新检查。</p><span>实时状态仅供参考 · 最终门禁以检查服务结果为准</span></div>
    </section>
  </>;
}

function Preflight() {
  const checklist = useExperimentStore((state) => state.preflightChecklist);
  const preflightPassed = useExperimentStore((state) => state.preflightPassed);
  const isChecking = useExperimentStore((state) => state.isCheckingPreflight);
  const runPreflightCheck = useExperimentStore((state) => state.runPreflightCheck);
  const systemCheckStatus = useExperimentStore((state) => state.systemCheckStatus);
  const environmentReady = useEnvironmentStore((state) => state.startup.phase === 'READY');
  const flight = useFlightStore((state) => state.status);
  const latest = useTelemetryStore((state) => state.latest);
  const passed = checklist.filter((item) => item.status === 'PASS').length;
  return <>
    <section className={styles.panel}>
      <h2><ClipboardCheck size={18} /> 起飞前安全检查清单</h2>
      <div className={styles.list}>{checklist.map((item, index) => <div className={styles.row} key={item.id}>
        <div><strong><span className={styles.number}>{String(index + 1).padStart(2, '0')}</span>{checklistNames[item.id] ?? item.label}</strong>{item.reason && <small>{item.reason}</small>}</div>
        <b className={item.status === 'PASS' ? styles.pass : item.status === 'FAIL' ? styles.fail : styles.wait}>{item.status === 'PASS' ? '通过' : item.status === 'FAIL' ? '未通过' : item.status === 'CHECKING' ? '检查中' : '待检查'}</b>
      </div>)}</div>
      <button className={styles.primary} type="button" disabled={isChecking || !environmentReady || systemCheckStatus !== 'PASSED'} onClick={() => void runPreflightCheck()}>{isChecking ? '正在逐项核验…' : preflightPassed ? '重新执行全部检查' : '执行全部检查'}</button>
    </section>
    <section className={styles.panel}>
      <h2><ShieldCheck size={18} /> 安全门禁与机体状态</h2>
      <div className={styles.metrics}>
        <div><span>已通过</span><strong>{passed}/{checklist.length}</strong></div>
        <div><span>电量</span><strong>{latest?.batteryPercent.toFixed(0) ?? flight.battery.toFixed(0)}%</strong></div>
        <div><span>GPS 卫星</span><strong>{latest?.gpsSatellites ?? '--'}</strong></div>
        <div><span>飞行模式</span><strong>{latest?.mode ?? flight.mode}</strong></div>
        <div><span>机体状态</span><strong>{flight.armed ? '已解锁' : '未解锁'}</strong></div>
        <div><span>心跳</span><strong>{latest ? latest.mavlinkStatus.heartbeat ? '在线' : '中断' : '--'}</strong></div>
      </div>
      <div className={`${styles.outcome} ${preflightPassed ? styles.outcomeGood : ''}`} role="status">
        {preflightPassed ? <><Check size={23} /><strong>检查通过 · 可进入飞行训练</strong></> : <><CircleAlert size={23} /><strong>未满足起飞条件 · 禁止解锁</strong></>}
        <p>检查通过 ≠ 已解锁 ≠ 已起飞；实际解锁仍在后续训练步骤执行。</p>
      </div>
      {checklist.filter((item) => item.status === 'FAIL').map((item) => <p className={styles.fail} key={item.id}>⚠ {checklistNames[item.id] ?? item.label}：{item.reason ?? '请排查并重新检查'}</p>)}
    </section>
  </>;
}

export function FlightReadinessStep({ stepId }: { stepId: 5 | 6 }) {
  const scene = useExperimentStore((state) => state.selectedScene);
  const validationMessage = useExperimentStore((state) => state.validationMessage);
  const systemCheckStatus = useExperimentStore((state) => state.systemCheckStatus);
  const preflightPassed = useExperimentStore((state) => state.preflightPassed);
  const goToPreviousStep = useExperimentStore((state) => state.goToPreviousStep);
  const goToNextStep = useExperimentStore((state) => state.goToNextStep);
  const environmentReady = useEnvironmentStore((state) => state.startup.phase === 'READY');
  const canAdvance = environmentReady && (stepId === 5 ? systemCheckStatus === 'PASSED' : preflightPassed && systemCheckStatus === 'PASSED');
  return <div className={styles.page}>
    <div className={`${styles.grid} ${stepId === 5 ? styles.diagnosticsGrid : ''}`}>
      {stepId === 5 ? <Diagnostics /> : <Preflight />}
      {stepId === 5 ? <DiagnosticQuiz /> : <SceneOverview sceneId={scene?.id ?? null} sceneName={scene?.name ?? null} />}
    </div>
    <div className={styles.footer}><span role="status" className={canAdvance ? styles.pass : styles.wait}>{validationMessage ?? (canAdvance ? stepId === 5 ? '飞控与传感器检查通过' : '起飞前安全检查通过' : '请完成当前步骤的全部检查')}</span><StepNavigation canGoBack canGoNext={canAdvance} nextLabel={stepId === 5 ? '下一步：起飞前检查' : '进入基础飞行训练'} onBack={goToPreviousStep} onNext={() => void goToNextStep()}/></div>
  </div>;
}
