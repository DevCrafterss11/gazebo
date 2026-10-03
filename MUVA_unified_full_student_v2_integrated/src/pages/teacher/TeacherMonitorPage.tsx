import { AlertTriangle, Crosshair, RadioTower, RotateCcw, ShieldAlert, Square, Users } from 'lucide-react';
import { useState } from 'react';

import styles from '../role/RolePages.module.css';

const monitorStudents = [
  ['张三', '实验中', '航点 3 / 5', '12.3m', 'AUTO', '正常'],
  ['李四', '实验中', '起飞阶段', '8.4m', 'GUIDED', '正常'],
  ['王五', '异常', '航点 2 / 5', '15.1m', 'AUTO', 'GPS 异常'],
  ['赵六', '实验中', '悬停阶段', '10.2m', 'LOITER', '剩余 4min'],
] as const;

export function TeacherMonitorPage() {
  const [selected, setSelected] = useState('张三');
  const selectedData = monitorStudents.find((item) => item[0] === selected) ?? monitorStudents[0]!;
  return (
    <div className={styles.rolePage}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><span className={styles.heroEyebrow}><RadioTower size={14} /> LIVE LAB MONITOR</span><h1>实验监控</h1><p>实时查看学生实验状态、任务阶段和异常事件。教师默认只读监控，仅保留安全终止与重置操作。</p></div>
        <div className={styles.heroAction}><strong>航点任务规划实验 · 软件工程 1 班</strong><span>28 人实验中 · 12 人已完成 · 2 人异常</span></div>
      </section>
      <div className={styles.statGrid}>
        <div className={styles.statCard}><div className={styles.statTop}><span>学生总数</span><Users size={18} /></div><div className={styles.statValue}><strong>42</strong><span>人</span></div><div className={styles.statFoot}>当前课程班级</div></div>
        <div className={styles.statCard}><div className={styles.statTop}><span>实验中</span><RadioTower size={18} /></div><div className={styles.statValue}><strong>28</strong><span>人</span></div><div className={styles.statFoot}><b>实时遥测已连接</b></div></div>
        <div className={styles.statCard}><div className={styles.statTop}><span>已完成</span><Crosshair size={18} /></div><div className={styles.statValue}><strong>12</strong><span>人</span></div><div className={styles.statFoot}>完成率 28.6%</div></div>
        <div className={styles.statCard}><div className={styles.statTop}><span>异常</span><AlertTriangle size={18} /></div><div className={styles.statValue}><strong>2</strong><span>人</span></div><div className={styles.statFoot}>需要教师关注</div></div>
      </div>
      <div className={styles.monitorLayout}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div className={styles.panelTitle}><Users size={18} />学生实验状态</div><span className={styles.panelSubtle}>点击学生查看实时详情</span></div>
          <div className={styles.dataTable}>
            <div className={`${styles.tableHead} ${styles.monitor}`}><span>学生</span><span>状态</span><span>当前阶段</span><span>高度</span><span>飞行模式</span><span>告警</span><span>操作</span></div>
            {monitorStudents.map(([name, state, stage, altitude, mode, alert]) => (
              <div className={`${styles.tableRow} ${styles.monitor}`} key={name} onClick={() => setSelected(name)} style={{ cursor: 'pointer', background: selected === name ? 'rgb(7 63 97 / 72%)' : undefined }}>
                <div className={styles.studentIdentity}><div className={styles.avatar}>{name.slice(0, 1)}</div><div className={styles.identityCopy}><strong>{name}</strong><span>无人机 Iris</span></div></div>
                <span className={`${styles.statusPill} ${state === '异常' ? styles.danger : styles.success}`}>{state}</span><span>{stage}</span><strong>{altitude}</strong><span>{mode}</span><span>{alert}</span><button className={styles.ghostButton} type="button">查看</button>
              </div>
            ))}
          </div>
        </section>
        <section className={styles.panel}>
          <div className={styles.panelHeader}><div className={styles.panelTitle}><Crosshair size={18} />{selected} · 实时详情</div><span className={styles.statusPill}>只读监控</span></div>
          <div className={styles.monitorMap}><div className={styles.droneDot}><RadioTower size={18} /></div><span className={styles.mapLabel}>{selected} · {selectedData[3]}</span></div>
          <div className={styles.telemetryGrid} style={{ marginTop: 10 }}>
            <div className={styles.telemetryCell}><span>当前阶段</span><strong>{selectedData[2]}</strong></div><div className={styles.telemetryCell}><span>飞行模式</span><strong>{selectedData[4]}</strong></div><div className={styles.telemetryCell}><span>高度</span><strong>{selectedData[3]}</strong></div><div className={styles.telemetryCell}><span>状态</span><strong>{selectedData[5]}</strong></div>
          </div>
          <div className={styles.toolbar} style={{ marginTop: 12, marginBottom: 0 }}><button className={styles.dangerButton} type="button"><Square size={12} />终止实验</button><button className={styles.ghostButton} type="button"><RotateCcw size={12} />安全重置</button></div>
          {selectedData[1] === '异常' ? <div className={styles.alertRow} style={{ marginTop: 10 }}><ShieldAlert size={15} /><div className={styles.alertCopy}><strong>检测到异常</strong><span>{selectedData[5]}，建议检查定位与 EKF 状态。</span></div></div> : null}
        </section>
      </div>
    </div>
  );
}
