import { Info, RotateCcw, Settings2, ShieldCheck } from 'lucide-react';

import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { validateIrisBasicFlightConfig } from '../../../../domain/experimentValidation';
import { defaultFlightControllerConfig } from '../../../../mocks/configuration';
import { useExperimentStore } from '../../../../stores/experimentStore';
import type { FlightParameters } from '../../../../types/configuration';
import { StepNavigation } from '../components/StepNavigation';
import styles from './ParameterConfigurationStep.module.css';

const fields: Array<{ key: keyof FlightParameters; label: string; range: string; unit: string; min: number; max: number; step: number; help: string }> = [
  { key: 'takeoffAltitude', label: '目标起飞高度', range: '1–50 m', unit: 'm', min: 1, max: 50, step: 1, help: '起飞后到达的目标高度，也是返航高度的下限。' },
  { key: 'maxAltitude', label: '最大飞行高度', range: '1–500 m', unit: 'm', min: 1, max: 500, step: 1, help: '教学模拟中的高度上限，不代表真实空域许可。' },
  { key: 'maxSpeed', label: '最大水平速度', range: '0.5–20 m/s', unit: 'm/s', min: 0.5, max: 20, step: 0.5, help: '限制任务中的平面移动速度。' },
  { key: 'rtlAltitude', label: '返航高度 RTL', range: '起飞高度至最大高度', unit: 'm', min: 1, max: 500, step: 1, help: '返航高度应不低于起飞目标，且不高于最大高度。' },
  { key: 'hoverDuration', label: '悬停目标时长', range: '1–120 s', unit: 's', min: 1, max: 120, step: 1, help: '悬停训练的目标持续时间。' },
];

export function ParameterConfigurationStep() {
  const configuration = useExperimentStore((state) => state.configuration);
  const selectedDrone = useExperimentStore((state) => state.selectedDrone);
  const updateFlightController = useExperimentStore((state) => state.updateFlightController);
  const updateFlightParameter = useExperimentStore((state) => state.updateFlightParameter);
  const goToPreviousStep = useExperimentStore((state) => state.goToPreviousStep);
  const goToNextStep = useExperimentStore((state) => state.goToNextStep);
  const validationMessage = useExperimentStore((state) => state.validationMessage);
  const parameters = configuration.flightParameters;
  const controller = configuration.flightController;
  const configurationError = validateIrisBasicFlightConfig(configuration);
  const irisReady = selectedDrone?.id === 'iris-quadrotor-01';
  const controllerReady = Object.entries(defaultFlightControllerConfig).every(([key, value]) => controller[key as keyof typeof controller] === value);
  const canGoNext = irisReady && !configurationError;

  return <div className={styles.page}>
    <div className={styles.main}>
      <PanelShell title="Iris 四旋翼 · 实验参数配置" icon={Settings2} action={<span>基础飞行训练</span>}>
        <div className={styles.content}>
          <div className={styles.identity}>
            <div><span>本次教学机型</span><strong>{selectedDrone?.name ?? '待确认 Iris 四旋翼'}</strong><small>已在步骤 1 完成系统组成认知，无需重新选择机型。</small></div>
            <div><span>固定教学构型</span><strong>{controller.autopilot} · {controller.frameClass} {controller.frameType}</strong><small>{controller.firmware} · {controller.protocol} · {controller.flightMode}</small></div>
          </div>
          {!controllerReady && <div className={styles.warning} role="alert">当前保存的构型与 Iris 四旋翼基础训练不符。<button type="button" onClick={() => updateFlightController(defaultFlightControllerConfig)}><RotateCcw size={14}/>恢复教学构型</button></div>}
          {!irisReady && <p className={styles.warning} role="alert">请返回步骤 1 完成 Iris 四旋翼认知后再配置飞行参数。</p>}
          <div className={styles.heading}><h2>飞行目标与安全限制</h2><p>只调整本次训练需要的五项参数。场景与 Home 点在下一步配置。</p></div>
          <div className={styles.fields}>{fields.map((field) => <label className={styles.field} key={field.key}>
            <span className={styles.fieldText}><strong>{field.label}</strong><small>{field.help}</small></span>
            <span className={styles.fieldInput}><input type="number" aria-label={field.label} min={field.min} max={field.max} step={field.step} value={Number.isFinite(parameters[field.key]) ? parameters[field.key] : ''} onChange={(event) => updateFlightParameter(field.key, event.target.value === '' ? Number.NaN : Number(event.target.value))}/><span>{field.unit}</span></span>
            <small className={styles.range}>{field.range}</small>
          </label>)}</div>
          <div className={`${styles.validation} ${!canGoNext ? styles.invalid : ''}`} role="status">{configurationError ?? '参数校验通过，可以进入场景配置'}</div>
        </div>
      </PanelShell>
      <PanelShell title="本次训练配置概览" icon={Info}>
        <div className={styles.overview}>
          <div><span>机型与飞行模式</span><strong>{selectedDrone?.name ?? '未确认'} · {controller.flightMode}</strong></div>
          <div><span>起飞 / 最大高度</span><strong>{parameters.takeoffAltitude} / {parameters.maxAltitude} m</strong></div>
          <div><span>返航高度 / 悬停</span><strong>{parameters.rtlAltitude} m / {parameters.hoverDuration} s</strong></div>
          <div><span>最大水平速度</span><strong>{parameters.maxSpeed} m/s</strong></div>
        </div>
      </PanelShell>
    </div>
    <aside className={styles.side}>
      <PanelShell title="参数设置提示" icon={ShieldCheck}>
        <div className={styles.notes}>
          <div><strong>为何固定机型与模式？</strong><p>本实验使用步骤 1 认识的 Iris 四旋翼，保持 Quad X 和 GUIDED 模式，避免训练中出现构型与机体不一致。</p></div>
          <div><strong>高度之间的关系</strong><p>起飞高度 ≤ RTL 返航高度 ≤ 最大飞行高度；超出范围不能进入下一步。</p></div>
          <div><strong>什么时候选择场景？</strong><p>下一步再确定训练场景和 Home 点；这里设置的是本次飞行的目标和限制。</p></div>
        </div>
      </PanelShell>
      <div className={`${styles.status} ${canGoNext ? styles.ready : ''}`} role="status">{validationMessage ?? (canGoNext ? '✓ 参数已就绪' : '请检查机型、构型和飞行参数')}</div>
      <div className={styles.navigation}><StepNavigation canGoBack canGoNext={canGoNext} nextLabel="下一步：场景配置" onBack={goToPreviousStep} onNext={() => void goToNextStep()}/></div>
    </aside>
  </div>;
}
