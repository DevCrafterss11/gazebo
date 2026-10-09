import { Activity, Check, Circle, ClipboardCheck, Info, LoaderCircle, Play, Radar, ShieldCheck } from 'lucide-react';

import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { useEnvironmentStore } from '../../../../stores/environmentStore';
import { useExperimentStore } from '../../../../stores/experimentStore';
import type { SensorCheckStatus } from '../../../../types/configuration';
import { ConfigurationSummary } from '../components/ConfigurationSummary';
import { StepNavigation } from '../components/StepNavigation';
import styles from '../components/WorkflowSteps.module.css';

interface SetupStepProps { stepId: number; }

const sensorStatusLabel: Record<SensorCheckStatus, string> = {
  WAITING: 'WAITING', CHECKING: 'CHECKING', PASS: 'PASS', FAIL: 'FAIL',
};
const preflightStatusLabel = { WAITING: 'WAITING', CHECKING: 'CHECKING', PASS: 'PASS', FAIL: 'FAIL' } as const;
const formatLogTime = (timestamp: string): string => new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

const teachingNotes: Record<number, Array<{ title: string; content: string }>> = {
  4: [{ title: '正确启动顺序', content: '浏览器通过 EnvironmentService 请求运行环境；当前教学环境在前端演示，未来 API 模式由 Gateway 启动系统进程。' }],
  5: [{ title: '状态检查，不是校准', content: 'SITL 实验检查 Heartbeat、GPS、IMU、Compass、Barometer 与 EKF 健康状态，不执行硬件校准。' }],
  6: [{ title: 'Preflight Checklist', content: '只有环境、连接、导航估计、Home、参数及未解锁状态全部通过，才能进入飞行训练。' }],
};

export function SetupStep({ stepId }: SetupStepProps) {
  const configuration = useExperimentStore((state) => state.configuration);
  const systemCheckStatus = useExperimentStore((state) => state.systemCheckStatus);
  const preflightChecklist = useExperimentStore((state) => state.preflightChecklist);
  const preflightPassed = useExperimentStore((state) => state.preflightPassed);
  const isCheckingSensors = useExperimentStore((state) => state.isCheckingSensors);
  const isCheckingPreflight = useExperimentStore((state) => state.isCheckingPreflight);
  const validationMessage = useExperimentStore((state) => state.validationMessage);
  const startSimulation = useExperimentStore((state) => state.startSimulation);
  const runSensorCheck = useExperimentStore((state) => state.runSensorCheck);
  const runPreflightCheck = useExperimentStore((state) => state.runPreflightCheck);
  const goToNextStep = useExperimentStore((state) => state.goToNextStep);
  const goToPreviousStep = useExperimentStore((state) => state.goToPreviousStep);
  const simulationStarted = useExperimentStore((state) => state.simulationStarted);
  const startup = useEnvironmentStore((state) => state.startup);
  const runtime = useEnvironmentStore((state) => state.runtime);
  const environmentLogs = useEnvironmentStore((state) => state.logs);
  const isStarting = useEnvironmentStore((state) => state.isStarting);
  const environmentReady = startup.phase === 'READY';

  const renderEnvironmentStartup = () => (
    <div className={styles.environmentLaunchContent}>
      <ConfigurationSummary />
      <button className={styles.primaryAction} type="button" disabled={isStarting || environmentReady} onClick={() => void startSimulation()}>
        {isStarting ? <LoaderCircle className={styles.spinning} size={17} /> : <Play size={17} />}
        {environmentReady ? '仿真环境 READY' : isStarting ? '正在启动仿真环境...' : '创建实验并启动仿真环境'}
      </button>
    </div>
  );

  const renderSystemCheck = () => (
    <div className={styles.sensorCheckContent}>
      <div className={styles.sensorGrid}>{configuration.sensors.map((sensor) => (
        <div className={`${styles.sensorCard} ${styles[sensor.status]}`} key={sensor.id}>
          <header><Radar size={19} /><strong>{sensor.name}</strong><span>{sensor.status === 'CHECKING' ? <LoaderCircle className={styles.spinning} size={14} /> : sensor.status === 'PASS' ? <Check size={14} /> : <Circle size={13} />}{sensorStatusLabel[sensor.status]}</span></header>
          {sensor.details.map((detail) => <small key={detail}>{detail}</small>)}
        </div>
      ))}</div>
      <button className={styles.primaryAction} type="button" disabled={isCheckingSensors || !environmentReady} onClick={() => void runSensorCheck()}>
        {isCheckingSensors ? <LoaderCircle className={styles.spinning} size={17} /> : <Activity size={17} />}{isCheckingSensors ? '正在执行系统检查...' : '开始系统检查'}
      </button>
    </div>
  );

  const renderPreflight = () => (
    <div className={styles.preflightContent}>
      <div className={styles.preflightGrid}>{preflightChecklist.map((item) => (
        <div className={`${styles.preflightItem} ${styles[item.status]}`} key={item.id}>
          {item.status === 'CHECKING' ? <LoaderCircle className={styles.spinning} size={17} /> : item.status === 'PASS' ? <Check size={17} /> : <Circle size={15} />}
          <span>{item.label}<small>{item.reason ?? ''}</small></span><strong>{preflightStatusLabel[item.status]}</strong>
        </div>
      ))}</div>
      <button className={styles.primaryAction} type="button" disabled={isCheckingPreflight || systemCheckStatus !== 'PASSED' || !environmentReady} onClick={() => void runPreflightCheck()}>
        <ShieldCheck size={17} />{isCheckingPreflight ? '正在执行起飞前检查...' : '执行起飞前检查'}
      </button>
    </div>
  );

  const renderMainContent = () => {
    if (stepId === 4) return renderEnvironmentStartup();
    if (stepId === 5) return renderSystemCheck();
    return renderPreflight();
  };

  const titles: Record<number, string> = { 4: '创建实验并启动仿真环境', 5: '飞控与传感器检查', 6: '起飞前检查' };
  const icons = { 4: Play, 5: Radar, 6: ShieldCheck } as const;
  const MainIcon = icons[stepId as keyof typeof icons] ?? Play;
  const canGoNext = stepId === 4 ? simulationStarted && environmentReady
        : stepId === 5 ? systemCheckStatus === 'PASSED'
          : preflightPassed;
  const successMessage = stepId === 4 && environmentReady ? 'ENVIRONMENT READY'
    : stepId === 5 && systemCheckStatus === 'PASSED' ? 'SYSTEM CHECK PASSED'
      : stepId === 6 && preflightPassed ? 'PRE-FLIGHT CHECK PASSED'
        : '当前步骤等待完成';

  return (
    <div className={styles.setupPage}>
      <div className={styles.setupMain}>
        <PanelShell title={titles[stepId] ?? '实验配置'} icon={MainIcon} action={<span>仿真环境</span>}>{renderMainContent()}</PanelShell>
        {stepId === 4 ? (
          <PanelShell title="环境启动进度与日志" icon={Play}>
            <div className={styles.startupPanel}>
              <div><span>{startup.phase} · {startup.message}</span><strong>{startup.progress}%</strong></div><progress max={100} value={startup.progress} />
              <div className={styles.runtimeGrid}>
                <span>Gazebo<strong>{runtime.gazebo}</strong></span><span>ArduPilot SITL<strong>{runtime.ardupilotSitl}</strong></span><span>MAVLink Gateway<strong>{runtime.mavlinkGateway}</strong></span><span>Heartbeat<strong>{runtime.heartbeat}</strong></span><span>Vehicle<strong>{runtime.vehicle}</strong></span>
              </div>
              <div className={styles.startupLogs} aria-label="环境启动日志">{environmentLogs.length === 0 ? <span>[--:--:--] 等待创建实验</span> : environmentLogs.map((entry) => <span key={`${entry.timestamp}-${entry.phase}`}>[{formatLogTime(entry.timestamp)}] {entry.phase} · {entry.message}</span>)}</div>
            </div>
          </PanelShell>
        ) : <PanelShell title="完整配置摘要" icon={Info}><ConfigurationSummary /></PanelShell>}
      </div>
      <div className={styles.setupSide}>
        <PanelShell title="教学说明" icon={ClipboardCheck}><div className={styles.teachingNotes}>{(teachingNotes[stepId] ?? []).map((note) => <div key={note.title}><strong>{note.title}</strong><p>{note.content}</p></div>)}</div></PanelShell>
        <div className={`${styles.readyCard} ${validationMessage ? styles.readyError : ''}`}><span className={styles.readyPulse} /><div><strong>{validationMessage ?? successMessage}</strong><small>流程依赖由 Store 与 Workflow 双重校验</small></div></div>
        <StepNavigation canGoBack canGoNext={canGoNext} nextLabel={stepId === 6 ? '进入基础飞行训练' : '下一步'} onBack={goToPreviousStep} onNext={() => void goToNextStep()} />
      </div>
    </div>
  );
}
