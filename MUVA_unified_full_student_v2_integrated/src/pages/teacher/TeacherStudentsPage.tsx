import { Download, Search, UserPlus, Users } from 'lucide-react';

import styles from '../role/RolePages.module.css';

const students = [
  ['张三', '20260001', '6 / 8', '91.2', '正常'],
  ['李四', '20260002', '6 / 8', '87.6', '正常'],
  ['王五', '20260003', '5 / 8', '82.1', '1 项异常'],
  ['赵六', '20260004', '5 / 8', '79.8', '1 项未完成'],
  ['陈七', '20260005', '6 / 8', '90.4', '正常'],
] as const;

export function TeacherStudentsPage() {
  return (
    <div className={styles.rolePage}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><span className={styles.heroEyebrow}><Users size={14} /> STUDENT MANAGEMENT</span><h1>学生管理</h1><p>查看课程学生、实验完成情况、平均成绩与异常记录。</p></div>
        <div className={styles.heroAction}><button className={styles.primaryButton} type="button"><UserPlus size={14} />添加学生</button><span>软件工程 1 班 · 42 人</span></div>
      </section>
      <div className={styles.toolbar}><div className={styles.filters}><div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 10, top: 12, color: '#6c9ab7' }} /><input className={styles.search} style={{ paddingLeft: 32 }} placeholder="按姓名 / 学号搜索" /></div><select className={styles.filter}><option>软件工程 1 班</option><option>软件工程 2 班</option></select></div><button className={styles.ghostButton} type="button"><Download size={13} />导出名单</button></div>
      <section className={styles.panel}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><Users size={18} />课程学生</div><span className={styles.panelSubtle}>已显示 5 / 42 人</span></div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.students}`}><span>学生</span><span>已完成实验</span><span>平均成绩</span><span>累计时长</span><span>状态</span><span>操作</span></div>
          {students.map(([name, id, done, score, state], index) => (
            <div className={`${styles.tableRow} ${styles.students}`} key={id}>
              <div className={styles.studentIdentity}><div className={styles.avatar}>{name.slice(0, 1)}</div><div className={styles.identityCopy}><strong>{name}</strong><span>{id}</span></div></div>
              <strong>{done}</strong><span className={styles.score}>{score}</span><span>{(8.2 + index * .4).toFixed(1)} h</span><span className={`${styles.statusPill} ${state === '正常' ? styles.success : styles.warning}`}>{state}</span><button className={styles.ghostButton} type="button">查看</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
