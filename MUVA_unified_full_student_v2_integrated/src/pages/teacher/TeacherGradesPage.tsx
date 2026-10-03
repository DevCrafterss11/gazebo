import { CheckCircle2, ClipboardCheck, Search, Trophy } from 'lucide-react';

import styles from '../role/RolePages.module.css';

const gradeRows = [
  ['张三', '20260001', '88', '9', '97', '已完成'],
  ['李四', '20260002', '81', '8', '89', '已完成'],
  ['王五', '20260003', '76', '--', '--', '待批改'],
  ['赵六', '20260004', '84', '8', '92', '已完成'],
] as const;

export function TeacherGradesPage() {
  return (
    <div className={styles.rolePage}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><span className={styles.heroEyebrow}><Trophy size={14} /> GRADE CENTER</span><h1>成绩管理</h1><p>汇总自动评分与实验报告评分，完成教师复核并发布最终成绩。</p></div>
        <div className={styles.heroAction}><strong>航点任务规划实验</strong><span>已评分 35 / 42 · 待批改 7</span></div>
      </section>
      <div className={styles.statGrid}>
        <div className={styles.statCard}><div className={styles.statTop}><span>班级平均分</span><Trophy size={18} /></div><div className={styles.statValue}><strong>87.5</strong><span>分</span></div><div className={styles.statFoot}><b>较上个实验 +1.8</b></div></div>
        <div className={styles.statCard}><div className={styles.statTop}><span>已完成评分</span><CheckCircle2 size={18} /></div><div className={styles.statValue}><strong>35</strong><span>人</span></div><div className={styles.statFoot}>完成率 83.3%</div></div>
        <div className={styles.statCard}><div className={styles.statTop}><span>待批改报告</span><ClipboardCheck size={18} /></div><div className={styles.statValue}><strong>7</strong><span>份</span></div><div className={styles.statFoot}>建议今日完成</div></div>
        <div className={styles.statCard}><div className={styles.statTop}><span>最高成绩</span><Trophy size={18} /></div><div className={styles.statValue}><strong>97</strong><span>分</span></div><div className={styles.statFoot}>张三 · 20260001</div></div>
      </div>
      <div className={styles.toolbar}><div className={styles.filters}><select className={styles.filter}><option>航点任务规划实验</option><option>基础飞行控制实验</option></select><div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 10, top: 12, color: '#6c9ab7' }} /><input className={styles.search} style={{ paddingLeft: 32 }} placeholder="搜索学生" /></div></div><button className={styles.primaryButton} type="button">发布成绩</button></div>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><ClipboardCheck size={18} />成绩明细</div><span className={styles.panelSubtle}>自动评分 90% + 报告评分 10%</span></div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.grades}`}><span>学生</span><span>自动评分</span><span>报告评分</span><span>最终成绩</span><span>状态</span><span>操作</span></div>
          {gradeRows.map(([name, id, auto, report, total, state]) => (
            <div className={`${styles.tableRow} ${styles.grades}`} key={id}>
              <div className={styles.studentIdentity}><div className={styles.avatar}>{name.slice(0, 1)}</div><div className={styles.identityCopy}><strong>{name}</strong><span>{id}</span></div></div><span>{auto}</span><span>{report}</span><strong className={styles.score}>{total}</strong><span className={`${styles.statusPill} ${state === '已完成' ? styles.success : styles.warning}`}>{state}</span><button className={styles.ghostButton} type="button">{state === '待批改' ? '批改' : '查看'}</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
