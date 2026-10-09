import { useState } from 'react';
import { Check } from 'lucide-react';
import { partLearning, parts, questions, tasks, type AssessmentConfig } from '../../../domain/assessment/model';
import { EXPERIMENT3_SCENES, getExperiment3Scene } from '../../../domain/assessment/experiment3Scenes';
import { useAssessmentStore, validConfig } from '../../../stores/assessmentStore';
import { FlightCanvas } from './FlightCanvas';
import { Experiment3Map } from './Experiment3Map';
import styles from './AssessmentPage.module.css';
import sceneStyles from './Experiment3Scenes.module.css';

export function CognitionStep() {
  const { run, learn, answerQuiz, submitQuiz } = useAssessmentStore();
  const [selected, select] = useState('frame');
  const [motion, setMotion] = useState<'roll' | 'pitch' | 'yaw' | 'throttle' | null>(null);
  const [playing, setPlaying] = useState(true);
  const [focusPart, setFocusPart] = useState(false);
  const [quizOpen, setQuizOpen] = useState(false);
  const choose = (id: string) => { select(id); learn(id); };
  const part = parts.find((item) => item.id === selected) ?? parts[0]!;
  const learning = partLearning[part.id]!;
  return <div className={`${styles.columns} ${styles.cognitionGrid}`}><section className={styles.panel}><h2>✈ 系统组成认知</h2><div className={`${styles.canvas} ${styles.cognitionCanvas}`}><FlightCanvas cognition selectedPart={selected} onPart={choose} demonstration={motion} demonstrationPlaying={playing} focusPart={focusPart}/><span className={styles.modelLabel}>{part.name} · 点击模型零件探索</span></div><div className={styles.toolbar}><button onClick={() => setFocusPart(!focusPart)}>{focusPart ? '返回整体' : '局部放大'}</button><button onClick={() => { setFocusPart(false); setMotion(null); setPlaying(true); }}>重置视角</button></div><div className={styles.partGrid}>{parts.map((item) => <button className={selected === item.id ? styles.selected : ''} onClick={() => choose(item.id)} key={item.id}>{run.learnedParts.includes(item.id) ? '✓ ' : '○ '}{item.name}</button>)}</div><p>已学习 {run.learnedParts.length} / {parts.length} · 点击机体/部件学习，当前：{part.name}</p></section>
    <section className={`${styles.panel} ${styles.mainPanel}`}><h2>控制链路与飞行原理</h2><div className={styles.controlFlow}>{['学生操作 / 目标指令','飞控控制器','电机输出','无人机姿态与运动','传感器测量 IMU / GPS','状态估计 EKF → 反馈控制'].map((name, index) => <div className={styles.flowNode} key={name}><b>{String(index + 1).padStart(2,'0')}</b>{name}</div>)}</div><h3>四旋翼基本运动原理</h3><div className={styles.motionGrid}>{(['roll','pitch','yaw','throttle'] as const).map((axis) => <button key={axis} className={motion === axis ? styles.selected : ''} onClick={() => { setMotion(axis); setPlaying(true); }}><strong>{axis.toUpperCase()}</strong><small>{({roll:'绕机头前后轴横滚',pitch:'绕左右轴俯仰',yaw:'绕竖直轴改变航向',throttle:'四电机同时增速，上升'})[axis]}</small></button>)}</div><div className={styles.toolbar}><button disabled={!motion} onClick={() => setPlaying(!playing)}>{playing ? '暂停动画' : '继续动画'}</button><button onClick={() => { setMotion(null); setPlaying(true); }}>重置动画</button></div><div className={styles.flow}>运动参考：{motion === 'roll' ? '绕机头前后轴，左右电机推力差' : motion === 'pitch' ? '绕左右轴，前后电机推力差' : motion === 'yaw' ? '绕竖直轴，对角旋翼扭矩差' : motion === 'throttle' ? '沿竖直方向上升，四电机共同增速' : '选择姿态轴查看推力变化'} · {playing ? '演示中' : '已暂停'}</div></section>
    <section className={styles.panel}><h2>学习目标与知识自测</h2><p>形成性学习检查，不计入最终综合成绩。</p><div className={styles.learningGoals}><p>① 认识八个核心部件及用途</p><p>② 理解飞控—电调—电机的闭环控制</p><p>③ 掌握 Roll / Pitch / Yaw / Throttle</p></div><h3>{part.name} · 功能与工作原理</h3><p>{part.role}</p><p>{part.principle}</p><p>与其他部件：{learning.connection}</p><p>对控制的影响：{learning.control}</p><p>常见异常：{learning.fault}</p><button className={styles.primary} onClick={() => setQuizOpen(!quizOpen)}>{quizOpen ? '收起自测' : '开始知识自测'}</button>{quizOpen && <div className={styles.list}>{questions.map((question) => <label key={question.id}>{question.question}<select value={run.quizAnswers[question.id] ?? ''} onChange={(event) => answerQuiz(question.id, event.target.value)}><option value="">请选择</option>{question.choices.map((choice) => <option key={choice}>{choice}</option>)}</select>{run.quizSubmitted && <small>{run.quizAnswers[question.id] === question.answer ? '正确' : '错误'} · {question.explanation}</small>}</label>)}<button onClick={submitQuiz}>提交自测</button>{run.quizSubmitted && <strong>知识得分：{run.scoreBreakdown.find((item) => item.ruleId === 'knowledge')?.actualScore}/10</strong>}</div>}</section></div>;
}
export function ConfigurationStep() {
  const { run, configure } = useAssessmentStore();
  const [form, setForm] = useState(run.configuration);
  const [answer, setAnswer] = useState(run.parameterAnswer ?? '');
  const numberField = (label: string, key: 'altitude' | 'speed' | 'hoverSeconds', unit: string) => <label key={key}>{label}<span><input type="number" value={form[key]} step="0.5" onChange={(event) => setForm({ ...form, [key]: Number(event.target.value) })}/>{unit}</span></label>;
  return <div className={styles.columns}><section className={styles.panel}><h2>飞行参数配置</h2><div className={styles.form}><label>机型<input readOnly value="Iris 四旋翼"/></label><label>模式<select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value as AssessmentConfig['mode'] })}><option value="GUIDED">Guided · 引导</option><option value="LOITER">Loiter · 定点</option></select></label>{numberField('起飞目标高度', 'altitude', 'm')}{numberField('巡航速度', 'speed', 'm/s')}{numberField('悬停目标时长', 'hoverSeconds', 's')}<label>训练难度<select value={form.difficulty ?? 'beginner'} onChange={(event) => setForm({ ...form, difficulty: event.target.value as AssessmentConfig['difficulty'] })}><option value="beginner">初级</option><option value="intermediate">中级</option><option value="advanced">高级</option></select></label><label>训练方式<select value={form.trainingMode} onChange={(event) => setForm({ ...form, trainingMode: event.target.value as AssessmentConfig['trainingMode'] })}><option value="guided">引导学习</option><option value="practice">自主练习</option><option value="exam">正式考核</option></select></label><label>理解题：高度参数决定什么？<select value={answer} onChange={(event) => setAnswer(event.target.value)}><option value="">请选择</option><option>高度决定起飞及悬停目标</option><option>高度只影响页面文字</option></select></label></div><button className={styles.primary} onClick={() => configure(form, answer)}>验证并确认参数</button><p>{run.configurationConfirmed ? '✓ 参数已保存到本次 Run' : '请明确确认参数'}</p></section>
    <section className={`${styles.panel} ${styles.mainPanel}`}><h2>参数影响预览</h2><div className={styles.canvas}><FlightCanvas cognition targetAltitude={form.altitude}/></div><div className={styles.flow}>起飞与悬停目标：{form.altitude}m · 稳定悬停：{form.hoverSeconds}s · 位移速度：{form.speed}m/s</div></section>
    <section className={styles.panel}><h2>模式说明</h2><div className={styles.metric}><span>Guided 引导</span><strong>位置目标与教学航点</strong></div><div className={styles.metric}><span>Loiter 定点</span><strong>保持当前位置</strong></div><div className={styles.metric}><span>RTL 返航</span><strong>飞回 Home 并降落</strong></div><p>飞行训练需要 GUIDED。高度 2–30m，速度 0–5m/s，悬停 3–60s；修改后旧任务和评分失效。</p><strong className={validConfig(form) ? styles.success : styles.warning}>{validConfig(form) ? '✓ 参数范围有效' : '⚠ 参数超出允许范围'}</strong><h3>任务目标摘要</h3><div className={styles.list}>{tasks.slice(0, 5).map((task, index) => <div className={styles.metric} key={task.taskId}><span>{index + 1}. {task.goal}</span><strong>{task.taskId === 'hover' ? `${form.hoverSeconds}s @ ${form.altitude}m` : task.taskId === 'takeoff' ? `${form.altitude}m` : '待训练'}</strong></div>)}</div></section></div>;
}
export function SceneStep() {
  const { run, chooseScene, confirmScene, startupBusy } = useAssessmentStore();
  const scene = getExperiment3Scene(run.selectedSceneId);
  const locked = run.environment !== 'STOPPED' || startupBusy;
  return <div className={sceneStyles.sceneGrid}>
    <section className={styles.panel}>
      <h2>选择训练场景</h2>
      <div className={sceneStyles.cards} role="radiogroup" aria-label="实验三训练场景">
        {EXPERIMENT3_SCENES.map((item) => <button type="button" role="radio" aria-checked={run.selectedSceneId === item.id} aria-label={item.name} key={item.id} disabled={locked} className={sceneStyles.card} onClick={() => chooseScene(item.id)}>
          <img src={item.previewImage} alt={`${item.name}卫星地图预览`}/>
          <span className={sceneStyles.cardBody}><strong>{item.name}</strong><span className={sceneStyles.sceneType}>{item.type}</span><small>{item.description}</small></span>
          {run.selectedSceneId === item.id && <span className={sceneStyles.selectedBadge}><Check size={13}/>已选择</span>}
        </button>)}
      </div>
      <button className={styles.primary} disabled={!scene || locked} onClick={confirmScene}>确认当前场景</button>
      <p>{locked ? '请先停止模拟环境，再更换场景。' : run.sceneConfirmed ? '✓ 场景已确认' : '请选择一个场景，确认后进入下一阶段。'}</p>
    </section>
    <section className={`${styles.panel} ${styles.mainPanel}`}>
      <h2>{scene ? `${scene.name} · 场景预览` : '场景预览 · 请选择训练场景'}</h2>
      <div className={styles.canvas}><Experiment3Map scene={run.selectedSceneId}/></div>
      <div className={styles.flow}>2D 卫星地图 + 四旋翼俯视标记 · Home / Target / 安全边界</div>
    </section>
    <section className={styles.panel}>
      <h2>当前场景</h2>
      {scene ? <><div className={styles.metric}><span>场景名称</span><strong>{scene.name}</strong></div><div className={styles.metric}><span>场景类型</span><strong>{scene.type}</strong></div><h3>训练目标</h3><p className={sceneStyles.sceneType}>{scene.trainingGoal}</p><p className={sceneStyles.sceneType}>{scene.description}</p><div className={styles.metric}><span>模拟安全区域</span><strong>{scene.trainingArea.width}m × {scene.trainingArea.length}m</strong></div><div className={styles.metric}><span>风险等级</span><strong>{scene.risk}</strong></div></> : <p>尚未选择场景。</p>}
      <p>卫星影像仅供环境认知，不作为定位、测绘或真实飞行依据。</p>
    </section>
  </div>;
}
export function StartupStep() {
  const { run, start, stop, startupBusy, setStartupFailure, flight, goTo } = useAssessmentStore();
  const scene = getExperiment3Scene(run.selectedSceneId);
  const phases = ['加载前端场景资源', '初始化 Mock 飞控', '建立模拟数据通信', '启动遥测生成器', '校验初始状态'];
  return <>
    <div className={sceneStyles.sceneGrid}>
      <section className={styles.panel}>
        <h2>启动前配置确认</h2>
        <div className={styles.metric}><span>无人机</span><strong>Iris 四旋翼</strong></div>
        <div className={styles.metric}><span>场景</span><strong>{scene?.name ?? '未选择场景'}</strong></div>
        <div className={styles.metric}><span>场景类型</span><strong>{scene?.type ?? '—'}</strong></div>
        {scene && <><h3>训练目标</h3><p>{scene.trainingGoal}</p><p>{scene.description}</p></>}
        <button disabled={startupBusy} onClick={() => goTo(2)}>返回场景选择</button>
        <p>此处仅确认已有配置，更换场景请返回上一步。</p>
      </section>
      <section className={`${styles.panel} ${styles.mainPanel}`}>
        <h2>场景预览 · {scene?.name ?? '未选择场景'}</h2>
        <div className={styles.canvas}><Experiment3Map scene={run.selectedSceneId} flight={flight}/></div>
        <div className={styles.flow}>2D 卫星地图 + 四旋翼俯视标记 · {run.environment === 'READY' ? '模拟环境已就绪' : '确认场景后启动教学模拟'}</div>
      </section>
      <section className={styles.panel}>
        <h2>Mock 启动任务</h2>
        {phases.map((phase, index) => <div key={phase} className={styles.metric}><span>{index + 1}. {phase}</span><strong>{run.simulationLog.length > index ? '✓' : '等待'}</strong></div>)}
        <label>开发教学：故障注入<select value={run.simulationFailure ?? ''} disabled={startupBusy} onChange={(event) => setStartupFailure(event.target.value ? event.target.value as 'scene' | 'link' | 'telemetry' : undefined)}><option value="">正常启动</option><option value="scene">场景加载失败</option><option value="link">通信初始化失败</option><option value="telemetry">遥测生成器失败</option></select></label>
        <div className={styles.toolbar}><button className={styles.primary} disabled={startupBusy || run.environment === 'READY' || !scene || !run.sceneConfirmed} onClick={() => void start()}>启动 / 重试</button><button disabled={startupBusy || run.environment === 'STOPPED'} onClick={() => void stop()}>停止 / 重置</button></div>
        <progress max={phases.length} value={run.simulationLog.length} aria-label="模拟环境启动进度"/>
        <p>环境状态：{run.environment}</p>
        {run.environmentError && <p className={styles.error}>{run.environmentError}</p>}
      </section>
    </div>
    <section className={styles.panel}><h2>系统事件日志</h2><div className={styles.scroll}>{run.simulationLog.map((item, index) => <p key={index}>{item}</p>)}</div></section>
  </>;
}
