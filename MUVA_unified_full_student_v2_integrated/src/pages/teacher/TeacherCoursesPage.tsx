import { ArrowRight, BookOpenCheck, CalendarDays, Plus, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

import styles from '../role/RolePages.module.css';

const courses = [
  { title: '无人机飞行控制', className: '软件工程 1 班', students: 42, experiments: 8, completion: '83%', score: '86.4' },
  { title: '无人机飞行控制', className: '软件工程 2 班', students: 40, experiments: 8, completion: '79%', score: '84.7' },
  { title: '无人机任务规划', className: '人工智能 1 班', students: 44, experiments: 6, completion: '68%', score: '82.9' },
];

export function TeacherCoursesPage() {
  return (
    <div className={styles.rolePage}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><span className={styles.heroEyebrow}><BookOpenCheck size={14} /> COURSE MANAGEMENT</span><h1>我的课程</h1><p>管理本学期授课班级、实验内容、学生与成绩数据。</p></div>
        <div className={styles.heroAction}><button className={styles.primaryButton} type="button"><Plus size={14} />创建课程</button><span>当前 3 个教学班</span></div>
      </section>
      <div className={styles.cardGrid}>
        {courses.map((course) => (
          <article className={styles.courseCard} key={`${course.title}-${course.className}`}>
            <div className={styles.cardIcon}><BookOpenCheck size={21} /></div>
            <h2>{course.title}</h2><p>{course.className} · 2026 秋季学期</p>
            <div className={styles.cardStats}>
              <span><Users size={12} />学生<strong>{course.students}</strong></span>
              <span><CalendarDays size={12} />实验<strong>{course.experiments}</strong></span>
              <span>平均成绩<strong>{course.score}</strong></span>
            </div>
            <div className={styles.progressRow}><div className={styles.progressLabel}><span>课程实验完成率</span><strong>{course.completion}</strong></div><div className={styles.progressTrack}><i style={{ width: course.completion }} /></div></div>
            <div className={styles.cardFooter}><span>最近更新：今天 13:48</span><Link to="/teacher/experiments">进入课程 <ArrowRight size={12} /></Link></div>
          </article>
        ))}
      </div>
    </div>
  );
}
