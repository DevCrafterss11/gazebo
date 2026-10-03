import { Award, BarChart3, GraduationCap, TrendingUp, Trophy } from 'lucide-react';

import styles from '../role/RolePages.module.css';

const grades = [
  ['基础飞行控制', '94', '90', '92', '已完成'],
  ['定点悬停训练', '89', '92', '90', '已完成'],
  ['航点任务规划', '86', '88', '87', '已完成'],
  ['PID 参数调节', '--', '--', '--', '未开始'],
];

export function StudentGradesPage() {
  return (
    <div className={styles.rolePage}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><span className={styles.heroEyebrow}><Trophy size={14} /> LEARNING RESULTS</span><h1>我的成绩</h1><p>查看自动评分、实验报告评分和课程学习趋势。</p></div>
        <div className={styles.heroAction}><strong>当前课程平均分 89.7</strong><span>班级参考排名：前 20%</span></div>
      </section>
      <div className={styles.statGrid}>
        <div className={styles.statCard}><div className={styles.statTop}><span>平均成绩</span><Award size={18} /></div><div className={styles.statValue}><strong>89.7</strong><span>分</span></div><div className={styles.statFoot}><b>较上阶段 +2.4</b></div></div>
        <div className={styles.statCard}><div className={styles.statTop}><span>最高成绩</span><Trophy size={18} /></div><div className={styles.statValue}><strong>94</strong><span>分</span></div><div className={styles.statFoot}>基础飞行控制</div></div>
        <div className={styles.statCard}><div className={styles.statTop}><span>已评分实验</span><GraduationCap size={18} /></div><div className={styles.statValue}><strong>3</strong><span>项</span></div><div className={styles.statFoot}>还有 1 项未开始</div></div>
        <div className={styles.statCard}><div className={styles.statTop}><span>成绩趋势</span><TrendingUp size={18} /></div><div className={styles.statValue}><strong>↑</strong><span>稳定</span></div><div className={styles.statFoot}><b>最近三次均高于 85</b></div></div>
      </div>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><BarChart3 size={18} />实验成绩明细</div><span className={styles.panelSubtle}>自动评分 + 教师评分</span></div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.grades}`}><span>实验</span><span>自动评分</span><span>报告评分</span><span>最终成绩</span><span>状态</span><span>结果</span></div>
          {grades.map(([name, auto, report, total, state]) => (
            <div className={`${styles.tableRow} ${styles.grades}`} key={name}>
              <strong>{name}</strong><span>{auto}</span><span>{report}</span><strong className={styles.score}>{total}</strong><span className={`${styles.statusPill} ${state === '已完成' ? styles.success : styles.warning}`}>{state}</span><button className={styles.ghostButton} type="button">查看</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
