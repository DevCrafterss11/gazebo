import { Check, ClipboardList, Crosshair, Plane, Ruler, Weight } from 'lucide-react';

import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { useExperimentStore } from '../../../../stores/experimentStore';
import { ConfigurationSummary } from '../components/ConfigurationSummary';
import { StepNavigation } from '../components/StepNavigation';
import styles from '../components/WorkflowSteps.module.css';

export function DroneSelectionStep() {
  const selectedDrone = useExperimentStore((state) => state.selectedDrone);
  const droneModels = useExperimentStore((state) => state.droneModels);
  const validationMessage = useExperimentStore((state) => state.validationMessage);
  const selectDrone = useExperimentStore((state) => state.selectDrone);
  const goToNextStep = useExperimentStore((state) => state.goToNextStep);

  if (droneModels.length === 0) {
    return <div className={styles.loadingState}>正在加载无人机教学模型...</div>;
  }

  return (
    <div className={styles.selectionPage}>
      <div className={styles.selectionMain}>
        <div className={styles.selectionTop}>
          <PanelShell title="无人机选择" icon={Plane} action={<span>选择本次实验使用的无人机型号</span>}>
            <div className={styles.droneCards}>
              {droneModels.map((drone) => {
                const selected = drone.id === selectedDrone?.id;
                return (
                  <button
                    className={`${styles.droneCard} ${selected ? styles.droneSelected : ''}`}
                    type="button"
                    aria-pressed={selected}
                    disabled={selected}
                    onClick={() => selectDrone(drone.id)}
                    key={drone.id}
                  >
                    <span className={styles.selectionCheck}>{selected ? <Check size={15} /> : null}</span>
                    {drone.recommended ? <span className={styles.recommendedBadge}>推荐教学机型</span> : null}
                    <span className={`${styles.droneDrawing} ${drone.rotorCount === 6 ? styles.hexaDrawing : ''}`}>
                      <i /><i /><i /><i />
                    </span>
                    <strong>{drone.name}</strong>
                    <small>最大起飞重量　{drone.maximumTakeoffWeightKg.toFixed(1)} kg</small>
                    <small>对角轴距　　　{drone.wheelbaseMillimeters} mm</small>
                    <small>最大速度　　　{drone.maximumSpeedMetersPerSecond} m/s</small>
                    <small>续航时间　　　{drone.enduranceMinutes} min</small>
                  </button>
                );
              })}
            </div>
          </PanelShell>
          <PanelShell title="无人机尺寸预览" icon={Ruler} action={<span>{selectedDrone?.name ?? '请选择机型'}</span>}>
            <div className={styles.dronePreview}>
              <span className={styles.previewDrone}><i /><i /><i /><i /></span>
              <span className={styles.widthRule}>{selectedDrone?.wheelbaseMillimeters ?? '--'} mm</span>
              <span className={styles.heightRule}>{selectedDrone?.heightMillimeters ?? '--'} mm</span>
              <div className={styles.previewStats}>
                <span><Ruler size={14} />轴距<strong>{selectedDrone?.wheelbaseMillimeters ?? '--'} mm</strong></span>
                <span><Weight size={14} />起飞重量<strong>{selectedDrone ? selectedDrone.maximumTakeoffWeightKg.toFixed(1) : '--'} kg</strong></span>
              </div>
            </div>
          </PanelShell>
        </div>
        <PanelShell title="场景预览：校园环境" icon={Crosshair} action={<span>Gazebo world · 基础飞行训练</span>}>
          <div className={styles.campusPreview}>
            <span className={styles.campusRoadOne} />
            <span className={styles.campusRoadTwo} />
            <span className={styles.campusLake} />
            <span className={styles.campusHome}>H</span>
            <span className={styles.campusPointOne}>1</span>
            <span className={styles.campusPointTwo}>2</span>
            <span className={styles.campusPointThree}>3</span>
            <div className={styles.campusLegend}>
              <strong>图例说明</strong>
              <span>H　起降点</span>
              <span>1-3　训练点</span>
              <span>---　推荐航线</span>
            </div>
          </div>
        </PanelShell>
      </div>
      <div className={styles.selectionSide}>
        <PanelShell title="实验配置摘要" icon={ClipboardList}>
          <ConfigurationSummary />
        </PanelShell>
        <PanelShell title="实验目标" icon={ClipboardList}>
          <div className={styles.goalList}>
            {['完成无人机起飞', '悬停 30 秒', '基础姿态控制', '执行返航', '安全降落'].map((goal, index) => (
              <div key={goal}><span>{index + 1}</span><strong>{goal}</strong><i /></div>
            ))}
          </div>
        </PanelShell>
        <StepNavigation
          canGoBack={false}
          canGoNext={selectedDrone !== null}
          nextLabel="下一步：实验参数配置"
          onBack={() => undefined}
          onNext={() => void goToNextStep()}
        />
        <div className={`${styles.operationTip} ${validationMessage ? styles.operationError : ''}`}>
          {validationMessage ?? '请选择无人机型号，确认后进入实验参数配置。'}
        </div>
      </div>
    </div>
  );
}
