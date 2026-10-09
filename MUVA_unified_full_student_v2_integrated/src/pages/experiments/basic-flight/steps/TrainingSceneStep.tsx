import { useState } from 'react';
import { Check, Compass, Home, MapPinned, ShieldCheck } from 'lucide-react';

import { useExperimentStore } from '../../../../stores/experimentStore';
import type { HomePosition, TrainingScene } from '../../../../types/configuration';
import { StepNavigation } from '../components/StepNavigation';
import styles from './TrainingSceneStep.module.css';

const sceneDetails: Record<string, { type: string; goal: string; focus: string; image: string; radius: number }> = {
  campus: { type: '校园', goal: '基础起飞 · 定点悬停 · 安全返航', focus: '对照开阔起飞区，识别建筑物与返航路径。', image: '/experiment3/scenes/campus-satellite.jpg', radius: 45 },
  city: { type: '城市', goal: '视距观察 · 安全边界 · 障碍识别', focus: '观察建筑密集区域；飞行训练仍以模拟器的基础任务为准。', image: '/experiment3/scenes/city-satellite.jpg', radius: 40 },
  mountain: { type: '山地', goal: '环境识别 · 高度管理 · RTL', focus: '注意山地起伏对返航高度判断的影响。', image: '/experiment3/scenes/mountain-satellite.jpg', radius: 50 },
  airport: { type: '机场', goal: '模拟起降 · 开阔区域 · 空域安全', focus: '仅限前端教学模拟；真实机场及管制空域禁止擅飞。', image: '/experiment3/scenes/airport-satellite.jpg', radius: 50 },
};

const sceneOrder = ['campus', 'city', 'mountain', 'airport'];

function ScenePreview({ scene, home }: { scene: TrainingScene | null; home: HomePosition | null }) {
  const details = scene && sceneDetails[scene.id];
  if (!scene || !details) return <div className={styles.emptyPreview}>
    <div className={styles.emptyMosaic} aria-hidden="true">{sceneOrder.map((id) => <img key={id} src={sceneDetails[id]?.image} alt="" />)}</div>
    <div className={styles.emptyMessage}><MapPinned size={34} /><strong>尚未选择训练场</strong><span>从左侧四个场景中选择一个，查看起飞点、目标和安全范围。</span></div>
  </div>;

  const validHome = home && Number.isFinite(home.latitude) && Math.abs(home.latitude) <= 90 && Number.isFinite(home.longitude) && Math.abs(home.longitude) <= 180 && Number.isFinite(home.altitude);
  const northMeters = validHome ? (home.latitude - scene.latitude) * 111111 : 0;
  const eastMeters = validHome ? (home.longitude - scene.longitude) * 111111 * Math.cos(scene.latitude * Math.PI / 180) : 0;
  const homeX = Math.min(85, Math.max(15, 48 + eastMeters / details.radius * 25));
  const homeY = Math.min(85, Math.max(15, 49 - northMeters / details.radius * 25));
  const mapPoint = { left: `${homeX}%`, top: `${homeY}%` };
  const targetPoint = { left: `${homeX}%`, top: `${Math.max(5, homeY - 20 / details.radius * 25)}%` };

  return <div className={styles.preview} data-scene-id={scene.id}>
    <img src={details.image} alt={`${scene.name}卫星影像参考`} />
    <div className={styles.shade} />
    {validHome && <>
      <div className={styles.boundary} style={{ ...mapPoint, width: `${details.radius / 60 * 80}%`, height: `${details.radius / 60 * 80}%` }} aria-label={`教学安全范围示意半径约 ${details.radius} 米`} />
      <span className={styles.homePoint} style={mapPoint}><Home size={15} /> Home · 起飞点</span>
      <span className={styles.targetPoint} style={targetPoint}><MapPinned size={15} /> 向北前进 20m · 示意</span>
      <svg className={styles.drone} style={mapPoint} viewBox="0 0 80 80" role="img" aria-label="起飞点处的四旋翼俯视标记，机头朝北"><g stroke="#baf5ff" strokeWidth="4" strokeLinecap="round"><path d="M21 21 59 59M59 21 21 59" /></g><g fill="#07324c" stroke="#6aebff" strokeWidth="2"><circle cx="18" cy="18" r="9"/><circle cx="62" cy="18" r="9"/><circle cx="18" cy="62" r="9"/><circle cx="62" cy="62" r="9"/></g><path d="M40 20 50 38 46 52 34 52 30 38Z" fill="#27c9ed" stroke="#dffbff" strokeWidth="2"/><path d="M40 18 35 27 45 27Z" fill="#ffe999"/></svg>
    </>}
    <span className={styles.north}><Compass size={16} /> N</span>
    <span className={styles.mapCaption}>Sentinel-2 © EOX / Copernicus 2016 · 影像与坐标未配准</span>
    <span className={styles.homeCoordinates}>{validHome ? `当前 Home：${home.latitude.toFixed(5)}°, ${home.longitude.toFixed(5)}°` : '请填写有效的 Home 坐标'}</span>
  </div>;
}

export function TrainingSceneStep() {
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  const scenes = useExperimentStore((state) => state.scenes);
  const selectedScene = useExperimentStore((state) => state.selectedScene);
  const configuration = useExperimentStore((state) => state.configuration);
  const validationMessage = useExperimentStore((state) => state.validationMessage);
  const selectScene = useExperimentStore((state) => state.selectScene);
  const updateHomePosition = useExperimentStore((state) => state.updateHomePosition);
  const goToPreviousStep = useExperimentStore((state) => state.goToPreviousStep);
  const goToNextStep = useExperimentStore((state) => state.goToNextStep);
  const displayedScenes = sceneOrder.map((id) => scenes.find((scene) => scene.id === id)).filter((scene): scene is TrainingScene => Boolean(scene));
  const currentScene = selectedScene && sceneDetails[selectedScene.id] ? selectedScene : null;
  const previewScene = previewSceneId ? displayedScenes.find((scene) => scene.id === previewSceneId) ?? null : currentScene;
  const details = previewScene ? sceneDetails[previewScene.id] : null;
  const home = configuration.homePosition;
  const homeValid = Boolean(home && Number.isFinite(home.latitude) && Math.abs(home.latitude) <= 90 && Number.isFinite(home.longitude) && Math.abs(home.longitude) <= 180 && Number.isFinite(home.altitude));
  const canGoNext = Boolean(currentScene && configuration.selectedSceneId === currentScene.id && homeValid);
  const homeFields: Array<{ key: keyof HomePosition; label: string; step: string }> = [
    { key: 'latitude', label: '纬度', step: '0.000001' }, { key: 'longitude', label: '经度', step: '0.000001' }, { key: 'altitude', label: '海拔 (m)', step: '0.1' },
  ];

  return <div className={styles.page}>
    <section className={`${styles.panel} ${styles.catalog}`}>
      <div className={styles.sectionHeader}><div><span className={styles.eyebrow}>STEP 03 / TRAINING GROUND</span><h2>选择训练场</h2></div><span className={styles.count}>4 个场景 · 单选</span></div>
      <p>比较不同环境的飞行条件，再选择本次基础飞行训练场。</p>
      {currentScene && <button type="button" className={styles.clearButton} onClick={() => { selectScene(''); setPreviewSceneId(null); }}>取消当前选择，重新比较场景</button>}
      <div className={styles.cards} role="radiogroup" aria-label="实验一训练场景">{displayedScenes.map((scene) => {
        const detail = sceneDetails[scene.id];
        if (!detail) return null;
        const selected = configuration.selectedSceneId === scene.id;
        return <button className={`${styles.card} ${selected ? styles.selected : ''}`} type="button" role="radio" aria-checked={selected} key={scene.id} onClick={() => { selectScene(scene.id); setPreviewSceneId(null); }} onMouseEnter={() => setPreviewSceneId(scene.id)} onMouseLeave={() => setPreviewSceneId(null)} onFocus={() => setPreviewSceneId(scene.id)} onBlur={() => setPreviewSceneId(null)}>
          <img src={detail.image} alt="" />
          <span className={styles.cardType}>{detail.type}环境</span>
          {selected && <span className={styles.badge}><Check size={13}/>已选择</span>}
          <span className={styles.cardContent}><strong>{scene.name}</strong><span>{scene.weather} · {scene.wind}</span><small>{scene.description}</small></span>
        </button>;
      })}</div>
      {displayedScenes.length < sceneOrder.length && <p role="status">部分训练场尚未加载，请检查场景服务。</p>}
      <div className={styles.learningNote}><ShieldCheck size={19}/><span><strong>选场提示</strong> · 比较建筑遮挡、地形与风况。机场仅用于模拟教学，真实飞行须遵守空域规定。</span></div>
    </section>

    <section className={`${styles.panel} ${styles.workspace}`}>
      <div className={styles.sectionHeader}><div><span className={styles.eyebrow}>SCENE OVERVIEW</span><h2>{previewScene ? `${previewScene.name} · 训练预览` : '训练预览'}</h2></div><span className={styles.count}>{previewSceneId ? '浏览预览 · 点击左侧确认' : previewScene ? 'Home / 目标 / 安全范围' : '等待选择'}</span></div>
      <ScenePreview scene={previewScene} home={previewScene?.id === currentScene?.id ? home : previewScene ? { latitude: previewScene.latitude, longitude: previewScene.longitude, altitude: previewScene.altitude } : null}/>
      <div className={styles.details}>
        <div className={styles.sceneFacts}>
          <h3>环境与训练目标</h3>
          {previewScene && details ? <>
            <div className={styles.info}><span>预览场景</span><strong>{previewScene.name} · {details.type}</strong></div>
            <div className={styles.info}><span>天气 / 风况</span><strong>{previewScene.weather} · {previewScene.wind}</strong></div>
            <div className={styles.info}><span>安全半径</span><strong>示意约 {details.radius} m</strong></div>
            <div className={styles.goal}><strong>训练目标</strong><span>{details.goal}</span></div>
            <p className={styles.focus}><ShieldCheck size={17}/>{details.focus}</p>
          </> : <p className={styles.placeholder}>选择左侧的训练场后，这里会展示环境条件与训练要点。</p>}
        </div>
        <div className={styles.homeSetup}>
          <h3>Home · 起飞点</h3>
          {currentScene ? <>
            <p>选场后自动载入该场景的起飞点；可在启动前修改。</p>
            <div className={styles.homeFields}>{homeFields.map((field) => <label key={field.key}>{field.label}<input type="number" step={field.step} aria-label={`Home ${field.label}`} value={home && Number.isFinite(home[field.key]) ? home[field.key] : ''} onChange={(event) => updateHomePosition(field.key, event.target.value === '' ? Number.NaN : Number(event.target.value))}/></label>)}</div>
            <button className={styles.resetButton} type="button" onClick={() => selectScene(currentScene.id)}>恢复场景默认 Home</button>
          </> : <p className={styles.placeholder}>尚未选场。选择场景后才会启用 Home 坐标设置。</p>}
        </div>
      </div>
      <div className={styles.footer}>
        <p className={styles.disclaimer}>卫星影像与 Home 坐标未经测绘配准，仅供模拟教学，不可用于真实飞行决策。</p>
        <div className={`${styles.status} ${canGoNext ? styles.ready : ''}`} role="status">{validationMessage ?? (canGoNext ? '✓ 场景与 Home 已就绪' : '请选择一个训练场，并确认有效的 Home 坐标')}</div>
        <StepNavigation canGoBack canGoNext={canGoNext} nextLabel="下一步：启动仿真环境" onBack={goToPreviousStep} onNext={() => void goToNextStep()}/>
      </div>
    </section>
  </div>;
}
