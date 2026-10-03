import { Beaker, Copy, FilePenLine, Plus, Rocket, SlidersHorizontal } from 'lucide-react';

import styles from '../role/RolePages.module.css';

const experiments = [
  ['基础飞行控制实验', '基础实验', '已结束', '42 / 42', '91.2'],
  ['航点任务规划实验', '任务实验', '进行中', '35 / 42', '87.5'],
  ['PID 参数调节实验', '控制实验', '已发布', '0 / 42', '--'],
  ['GPS 故障处理实验', '故障实验', '草稿', '--', '--'],
];

export function TeacherExperimentsPage() {
  return (
    <div className={styles.rolePage}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><span className={styles.heroEyebrow}><Beaker size={14} /> EXPERIMENT DESIGN</span><h1>实验管理</h1><p>创建实验、配置仿真环境与学生操作权限，并控制实验发布节奏。</p></div>
        <div className={styles.heroAction}><button className={styles.primaryButton} type="button"><Plus size={14} />创建实验</button><span>支持草稿、发布、进行中、已结束</span></div>
      </section>
      <div className={styles.toolbar}>
        <div className={styles.filters}><select className={styles.filter} defaultValue="无人机飞行控制"><option>无人机飞行控制</option><option>无人机任务规划</option></select><select className={styles.filter} defaultValue="全部状态"><option>全部状态</option><option>草稿</option><option>已发布</option><option>进行中</option><option>已结束</option></select><input className={styles.search} placeholder="搜索实验名称" /></div>
        <button className={styles.ghostButton} type="button"><Copy size={13} />实验模板</button>
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><SlidersHorizontal size={18} />实验列表</div><span className={styles.panelSubtle}>无人机飞行控制 · 软件工程 1 班</span></div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.experiments}`}><span>实验名称</span><span>类型</span><span>状态</span><span>完成情况</span><span>平均成绩</span><span>操作</span></div>
          {experiments.map(([name, type, state, completion, score]) => {
            const stateClass = state === '已结束' ? styles.success : state === '进行中' ? styles.warning : '';
            return <div className={`${styles.tableRow} ${styles.experiments}`} key={name}>
              <div className={styles.studentIdentity}><div className={styles.cardIcon}><Rocket size={16} /></div><div className={styles.identityCopy}><strong>{name}</strong><span>实验环境：Iris + ArduPilot</span></div></div>
              <span>{type}</span><span className={`${styles.statusPill} ${stateClass}`}>{state}</span><strong>{completion}</strong><span className={styles.score}>{score}</span><button className={styles.ghostButton} type="button"><FilePenLine size={12} />管理</button>
            </div>;
          })}
        </div>
      </section>
      <div className={styles.threeColumn} style={{ marginTop: 12 }}>
        <section className={styles.panel}><div className={styles.panelHeader}><div className={styles.panelTitle}>① 基本信息</div></div><p className={styles.panelSubtle}>实验名称、教学目标、建议时长、实验说明。</p></section>
        <section className={styles.panel}><div className={styles.panelHeader}><div className={styles.panelTitle}>② 仿真配置</div></div><p className={styles.panelSubtle}>无人机型号、Gazebo 场景、初始位置、环境参数。</p></section>
        <section className={styles.panel}><div className={styles.panelHeader}><div className={styles.panelTitle}>③ 权限与评分</div></div><p className={styles.panelSubtle}>控制学生允许操作、最大高度、实验时长与自动评分规则。</p></section>
      </div>
    </div>
  );
}
