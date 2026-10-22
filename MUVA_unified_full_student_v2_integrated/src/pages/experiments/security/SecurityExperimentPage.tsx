import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Check, CircleHelp, Download, Radio, Shield, ShieldAlert, Square, Wifi, WifiOff } from 'lucide-react';
import { useSecurityExperimentStore } from '../../../stores/securityExperimentStore';
import type { SecurityCase, SecurityConfig, SecurityJudgment } from '../../../types/securityExperiment';
import styles from './SecurityExperimentPage.module.css';

const steps = ['原理学习', '环境检查', '正常对照', '异常观察', '判断与处置', '恢复验证', '复盘评分'];
const judgmentOptions: Array<{ value: SecurityJudgment; label: string }> = [
  { value: 'normal', label: '正常' }, { value: 'link_anomaly', label: '链路异常' }, { value: 'replay', label: '数据重放' }, { value: 'insufficient_evidence', label: '证据不足' },
];

function downloadReport(report: unknown, runId: string): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `security-${runId}.json`; anchor.click(); URL.revokeObjectURL(url);
}

export function SecurityExperimentPage() {
  const run = useSecurityExperimentStore((state) => state.run);
  const report = useSecurityExperimentStore((state) => state.report);
  const busy = useSecurityExperimentStore((state) => state.busy);
  const error = useSecurityExperimentStore((state) => state.error);
  const reflection = useSecurityExperimentStore((state) => state.reflection);
  const initialize = useSecurityExperimentStore((state) => state.restore);
  const create = useSecurityExperimentStore((state) => state.create);
  const baseline = useSecurityExperimentStore((state) => state.baseline);
  const anomaly = useSecurityExperimentStore((state) => state.anomaly);
  const judge = useSecurityExperimentStore((state) => state.judge);
  const isolate = useSecurityExperimentStore((state) => state.isolate);
  const stop = useSecurityExperimentStore((state) => state.stop);
  const verify = useSecurityExperimentStore((state) => state.verify);
  const finish = useSecurityExperimentStore((state) => state.finish);
  const abort = useSecurityExperimentStore((state) => state.abort);
  const setReflection = useSecurityExperimentStore((state) => state.setReflection);
  const history = useSecurityExperimentStore((state) => state.history);
  const [showHistory, setShowHistory] = useState(false);
  const [caseId, setCaseId] = useState<SecurityCase>('replay');
  const [mode, setMode] = useState<SecurityConfig['mode']>('training');
  const [difficulty, setDifficulty] = useState<SecurityConfig['difficulty']>('medium');
  const [judgment, setJudgment] = useState<SecurityJudgment | ''>('');
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);
  const reportRef = useRef<HTMLElement>(null);

  function showReport(): void {
    reportRef.current?.focus({ preventScroll: true });
    reportRef.current?.scrollIntoView({ block: 'start' });
  }

  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => { setJudgment(run?.judgment ?? ''); setSelectedEvidence(run?.evidenceIds ?? []); }, [run?.runId]);
  useEffect(() => { if (report) showReport(); }, [report]);
  const phaseIndex = useMemo(() => {
    if (!run) return -1;
    return ({ preparation: 1, baseline: 2, anomaly: 3, recovery: 5, completed: 6, aborted: 6, failed: 6 } as const)[run.phase];
  }, [run]);
  const stale = !run?.telemetry || run.telemetry.stale || Date.now() - run.telemetry.receivedAt > 3000;
  const available = run?.source !== 'unavailable';
  const phaseText = run?.phase ?? 'preparation';
  const selectable = !!run && (run.phase === 'anomaly' || run.phase === 'baseline');

  return <main className={styles.page}>
    <header className={styles.header}><div><div className={styles.eyebrow}>EXPERIMENT 04 · ISOLATED TELEMETRY LAB</div><h1><ShieldAlert size={26} />安全攻防对抗</h1><p>观察专属实验遥测通道中的数据可信度与链路连续性；不触碰飞控控制指令。</p></div><div className={styles.badges}><span className={styles.badge}><Radio size={15} />{mode === 'training' ? '训练模式' : '考核模式'}</span><span className={`${styles.badge} ${stale ? styles.bad : styles.good}`}>{stale ? <WifiOff size={15} /> : <Wifi size={15} />}{stale ? '数据不可用 / 过期' : '遥测新鲜'}</span><span className={styles.badge}>阶段：{phaseText}</span>{report && <button className={styles.primary} onClick={showReport}>查看成绩 · {report.score?.total ?? 0} 分</button>}</div></header>
    {error && <div role="alert" className={styles.error}><AlertTriangle size={17} />{error}</div>}

    {!run && !report && <section className={styles.setup}>
      <div className={styles.caseGrid}>
        <button type="button" className={`${styles.caseCard} ${caseId === 'replay' ? styles.selected : ''}`} onClick={() => setCaseId('replay')}><Activity /><b>案例 A · 遥测重放</b><span>检查原始序列号、采集时间与接收顺序，隔离旧数据后验证实时流恢复。</span></button>
        <button type="button" className={`${styles.caseCard} ${caseId === 'degradation' ? styles.selected : ''}`} onClick={() => setCaseId('degradation')}><Wifi /><b>案例 B · 链路退化</b><span>观察受控延迟、丢包与短时中断；确认页面通道恢复而非推断飞控失联。</span></button>
      </div>
      <div className={styles.formRow}><label>运行模式<select value={mode} onChange={(event) => setMode(event.target.value as SecurityConfig['mode'])}><option value="training">训练模式（显示案例与提示）</option><option value="assessment">考核模式（服务端选取案例）</option></select></label><label>难度<select value={difficulty} onChange={(event) => setDifficulty(event.target.value as SecurityConfig['difficulty'])}><option value="low">基础</option><option value="medium">标准</option><option value="high">进阶</option></select></label><button disabled={busy} className={styles.primary} onClick={() => void create({ caseId, mode, difficulty })}>创建独立运行</button></div>
      <p className={styles.note}><CircleHelp size={15} />开始不会 ARM、起飞或发送飞行命令。API 模式必须真实连接 Gateway；Mock 与 API 数据和成绩分别标识。</p>
    </section>}

    {run && <>
      <nav className={styles.steps}>{steps.map((step, index) => <span key={step} data-active={index === phaseIndex} data-done={index < phaseIndex}><i>{index < phaseIndex ? <Check size={13} /> : index + 1}</i>{step}</span>)}</nav>
      <div className={styles.grid}>
        <section className={styles.panel}><h2><Activity size={17} />遥测监测</h2><div className={styles.metrics}><div><small>数据源</small><b>{run.source === 'mavlink' ? '真实 Gateway / MAVLink' : run.source === 'simulation' ? '确定性模拟' : '不可用'}</b></div><div><small>序列号</small><b>{run.telemetry?.sequence ?? '—'}</b></div><div><small>数据年龄</small><b className={stale ? styles.red : ''}>{run.telemetry ? `${Math.max(0, Date.now() - run.telemetry.capturedAt)} ms${stale ? ' · 过期' : ''}` : '未知'}</b></div><div><small>接收间隔 / 可计算缺失率</small><b>{run.telemetry?.receiveIntervalMs == null ? '未知' : `${run.telemetry.receiveIntervalMs} ms`} / {run.telemetry?.missingRatePct == null ? '未知' : `${run.telemetry.missingRatePct.toFixed(1)}%`}</b></div><div><small>高度 / 速度</small><b>{run.telemetry ? `${run.telemetry.altitude.toFixed(1)} m / ${run.telemetry.speed.toFixed(1)} m/s` : '—'}</b></div><div><small>当前通道</small><b>{run.telemetry?.connection === 'interrupted' ? '页面遥测短时中断' : run.telemetry?.connection ?? '等待连接'}</b></div></div><div className={`${styles.lastSample} ${stale ? styles.stale : ''}`}>{stale ? '最后观测已过期：保留显示但不作为健康数据' : '最新观测有效'} · 接收时刻 {run.telemetry ? new Date(run.telemetry.receivedAt).toLocaleTimeString() : '等待首帧'}</div>
          {run.config.mode === 'training' && <aside className={styles.hint}><b>训练提示</b><p>{run.config.caseId === 'replay' ? '比较序列号与采集/接收时刻。合法重连应有新运行内基准；重复或倒退序列可能是旧数据。' : '观察数据年龄、接收间隔和中断标记。页面遥测通道退化不等于飞控失联。'}</p></aside>}
        </section>
        <section className={styles.panel}><h2><Shield size={17} />操作与判断</h2><div className={styles.actionStack}>
          {run.phase === 'preparation' && <><p>{run.config.mode === 'training' ? `已选择：${run.config.caseId === 'replay' ? '遥测重放' : run.config.caseId === 'degradation' ? '链路退化' : '服务端随机案例'} · ${run.config.difficulty}` : '考核案例和触发时机由服务端保管，运行中不向客户端发送答案。'} 创建 runId：<code>{run.runId}</code></p><button className={styles.primary} disabled={busy || !available} onClick={() => void baseline()}>开始正常遥测对照</button></>}
          {run.phase === 'baseline' && <><p>收集正常接收基线后进入异常观察。正常波动也会参与误报评价。</p><button className={styles.primary} disabled={busy || !run.telemetry} onClick={() => void anomaly()}>进入观察阶段</button></>}
          {(run.phase === 'anomaly' || run.phase === 'baseline') && <><label>学生判断<select disabled={!selectable} value={judgment} onChange={(event) => setJudgment(event.target.value as SecurityJudgment)}><option value="">请选择</option>{judgmentOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className={styles.evidenceChoices}>{run.evidence.map((item) => <label key={item.id}><input type="checkbox" checked={selectedEvidence.includes(item.id)} onChange={(event) => setSelectedEvidence((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.detail}</label>)}</div><button disabled={busy || !judgment || !selectable} onClick={() => void judge(judgment as SecurityJudgment, selectedEvidence)}>提交判断与证据</button><button disabled={busy || run.isolation !== 'not_submitted'} onClick={() => void isolate()}>隔离异常数据</button><button disabled={busy || run.phase !== 'anomaly'} onClick={() => void stop()}>停止注入并恢复订阅</button></>}
          {run.phase === 'recovery' && <><p>恢复计数由通道连续新鲜遥测确认，不按点击直接通过。需连续收到至少 3 条实时样本。</p><button disabled={busy} onClick={() => void verify()}>验证恢复状态</button>{run.isolation === 'verified' && <button className={styles.primary} disabled={busy} onClick={() => void finish()}>结束实验并结算</button>}</>}
          {run.error && <p className={styles.errorText}>{run.error}</p>}
          {!['completed', 'aborted', 'failed'].includes(run.phase) && <button className={styles.danger} disabled={busy} onClick={() => void abort()}><Square size={14} />中止并清理运行</button>}
        </div></section>
        <section className={styles.panel}><h2><AlertTriangle size={17} />自动告警与证据 <small>({run.evidence.length})</small></h2><div className={styles.evidenceList}>{run.evidence.length ? [...run.evidence].reverse().map((item) => <article key={item.id}><b>{item.code}</b><p>{item.detail}</p><small>接收 {new Date(item.receivedAt).toLocaleTimeString()} · 自动检测</small></article>) : <p className={styles.muted}>等待可验证的异常证据；未知指标不会伪造。</p>}</div></section>
        <section className={styles.panel}><h2><Activity size={17} />事件时间线</h2><ol className={styles.timeline}>{[...run.timeline].reverse().map((event, index) => <li key={`${event.at}-${event.kind}-${index}`}><time>{new Date(event.at).toLocaleTimeString()}</time><span>{event.label}</span></li>)}</ol></section>
      </div>
    </>}

    {(report || run?.phase === 'completed' || run?.phase === 'aborted') && <section ref={reportRef} tabIndex={-1} aria-label="实验成绩报告" className={styles.report}><h2>实验报告 · {report?.scoreSource === 'gateway' ? 'API 服务端成绩' : 'Mock 模拟成绩'}</h2>{report && <><div className={styles.score}>{report.score?.total ?? 0}<small>/100</small></div><p>运行 {report.runId} · 恢复耗时 {report.recoveryMs === null ? '未知' : `${report.recoveryMs} ms`}</p><div className={styles.scoreGrid}>{Object.entries(report.score?.sections ?? {}).map(([key, value]) => <div key={key}>{key}<b>{value}</b></div>)}</div><ul>{report.score?.deductions.map((item) => <li key={item}>{item}</li>)}</ul><button onClick={() => downloadReport(report, report.runId)}><Download size={15} />导出 JSON 报告</button><p className={styles.note}>本实验不评价飞行完成率、真实飞控防御或真实网络攻击阻断效果。</p></>}</section>}
    {run && ['completed', 'aborted', 'failed'].includes(run.phase) && !report && <section className={styles.report}><h2>复盘与结算</h2><label>复盘分析（至少 20 字可得满额复盘分）<textarea value={reflection} onChange={(event) => setReflection(event.target.value)} rows={3} /></label><button className={styles.primary} disabled={busy} onClick={() => void finish()}>保存复盘并生成报告</button></section>}
    {run && !['completed', 'aborted', 'failed'].includes(run.phase) && <section className={styles.reflection}><h2>复盘记录</h2><textarea value={reflection} onChange={(event) => setReflection(event.target.value)} rows={2} placeholder="记录判断依据、处置过程和仍不确定的指标……" /><button className={styles.danger} disabled={busy} onClick={() => void abort()}>中止并保存</button></section>}
    {report && <button className={styles.restart} onClick={() => { useSecurityExperimentStore.getState().clear(); setJudgment(''); setSelectedEvidence([]); }}>开始下一次运行</button>}
    <section className={styles.history}><button onClick={() => setShowHistory((shown) => !shown)}>历史报告（{history.length}）{showHistory ? '收起' : '展开'}</button>{showHistory && history.map((item) => <article key={item.runId}><span>{item.runId} · {item.config.mode === 'assessment' ? '考核' : '训练'} · {item.scoreSource === 'gateway' ? 'API' : 'Mock'} · {item.score?.total ?? '—'} 分</span><button onClick={() => downloadReport(item, item.runId)}><Download size={14} />导出</button></article>)}</section>
    <footer>Gateway 到当前实验页面的遥测通道 · 不代表飞控失联 · 不验证 ArduPilot 失联保护 · 无真实身份认证，考核结果不具备正式防篡改属性</footer>
  </main>;
}
