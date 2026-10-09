import { useEffect, useMemo, useState } from 'react';
import type { ExperimentRun, FlightFrame, SimulationSnapshot } from '../../../domain/assessment/model';
import { Experiment3Map } from './Experiment3Map';
import styles from './AssessmentPage.module.css';
import examStyles from './AssessmentExam.module.css';

function frameFlight(frame: FlightFrame): SimulationSnapshot {
  return { position: { x: frame.x, y: frame.y, z: frame.z }, attitude: { roll: frame.roll, pitch: frame.pitch, yaw: frame.yaw }, velocity: { vx: frame.vx, vy: frame.vy, vz: frame.vz }, battery: frame.battery ?? 0, armed: frame.armed ?? frame.y > 0.1, airborne: frame.y > 0.1, mode: frame.mode ?? 'REPLAY', flightStatus: '回放中', homePosition: { x: 0, y: 0, z: 0 }, targetPosition: { x: frame.x, y: frame.y, z: frame.z }, telemetryTimestamp: frame.timestamp, paused: false };
}

export function FlightReplay({ run, taskId }: { run: ExperimentRun; taskId?: string }) {
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState(0);
  const [speed, setSpeed] = useState(1);
  const curves = useMemo(() => {
    const stride = Math.max(1, Math.ceil(run.trajectory.length / 200));
    const samples = run.trajectory.filter((_, sampleIndex) => sampleIndex % stride === 0);
    return [{ name: '高度（m）', values: samples.map((sample) => sample.y) }, { name: '水平速度（m/s）', values: samples.map((sample) => Math.hypot(sample.vx, sample.vz)) }].map((curve) => {
      const maximum = Math.max(1, ...curve.values);
      return { name: curve.name, maximum, points: curve.values.map((value, sampleIndex) => `${sampleIndex / Math.max(1, curve.values.length - 1) * 480},${80 - value / maximum * 70}`).join(' ') };
    });
  }, [run.trajectory]);
  useEffect(() => {
    const found = run.trajectory.findIndex((frame) => frame.taskId === taskId);
    if (found >= 0) { setPlaying(false); setIndex(found); }
  }, [taskId, run.trajectory]);
  useEffect(() => {
    if (!playing) return;
    const frame = run.trajectory[index];
    const next = run.trajectory[index + 1];
    if (!frame || !next) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setIndex(index + 1), Math.max(30, (next.timestamp - frame.timestamp) / speed));
    return () => window.clearTimeout(timer);
  }, [playing, index, speed, run.trajectory]);
  const frame = run.trajectory[index];
  return <section className={`${styles.panel} ${styles.mainPanel}`}><h2>二维卫星地图轨迹回放</h2><div className={styles.canvas}><Experiment3Map flight={frame ? frameFlight(frame) : undefined} scene={run.selectedSceneId} trajectory={run.trajectory.slice(0, index + 1)} showFlightPath/></div><div className={styles.toolbar}><button disabled={!run.trajectory.length} onClick={() => { if (index >= run.trajectory.length - 1) setIndex(0); setPlaying(!playing); }}>{playing ? '暂停' : '播放'}</button><button onClick={() => { setIndex(0); setPlaying(false); }}>重头播放</button><select aria-label="回放速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value="1">1×</option><option value="2">2×</option></select><input aria-label="轨迹回放进度" type="range" min="0" max={Math.max(0, run.trajectory.length - 1)} value={index} onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)); }}/></div><p>{frame ? `时间 ${new Date(frame.timestamp).toLocaleTimeString()} · 高度 ${frame.y.toFixed(1)}m · 速度 ${Math.hypot(frame.vx, frame.vz).toFixed(1)}m/s · 航向 ${frame.yaw.toFixed(0)}° · 电量 ${frame.battery?.toFixed(0) ?? '--'}% · 任务 ${frame.taskId ?? '准备'}${frame.event ? ` · 异常：${frame.event}` : ''}` : '本次尚无飞行轨迹'}</p><h3>遥测曲线 · 高度与水平速度</h3><div className={examStyles.telemetryCurves}>{curves.map((curve) => <figure key={curve.name}><figcaption>{curve.name} · 上限 {curve.maximum.toFixed(1)}</figcaption><svg viewBox="0 0 480 90" role="img" aria-label={`${curve.name}随轨迹时间变化`}><path d="M0 80 H480" stroke="#225578"/><polyline points={curve.points} fill="none" stroke="#34dcec" strokeWidth="2"/></svg></figure>)}</div></section>;
}
