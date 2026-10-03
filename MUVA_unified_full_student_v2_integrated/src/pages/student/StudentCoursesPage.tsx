import { ArrowRight, BookOpenCheck, CalendarDays, GraduationCap, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

import styles from '../role/RolePages.module.css';

const courses = [
  { title: '无人机飞行控制', teacher: '张老师', className: '软件工程 1 班', progress: '80%', experiments: '8', done: '6', next: '航点任务规划' },
  { title: '无人机任务规划', teacher: '李老师', className: '软件工程 1 班', progress: '62%', experiments: '6', done: '3', next: '多航点路径实验' },
  { title: '无人机安全实验', teacher: '王老师', className: '软件工程 1 班', progress: '35%', experiments: '5', done: '2', next: 'GPS 异常诊断' },
];

export function StudentCoursesPage() {
  return (
    <div className={styles.rolePage}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}><span className={styles.heroEyebrow}><BookOpenCheck size={14} /> MY COURSES</span><h1>我的课程</h1><p>查看本学期课程、实验进度和下一项学习任务。</p></div>
        <div className={styles.heroAction}><strong>共 3 门课程</strong><span>2026 秋季学期</span></div>
      </section>
      <div className={styles.cardGrid}>
        {courses.map((course) => (
          <article className={styles.courseCard} key={course.title}>
            <div className={styles.cardIcon}><GraduationCap size={21} /></div>
            <h2>{course.title}</h2>
            <p>{course.teacher} · {course.className}</p>
            <div className={styles.cardStats}>
              <span><Users size={12} />实验总数<strong>{course.experiments}</strong></span>
              <span><CalendarDays size={12} />已完成<strong>{course.done}</strong></span>
              <span>课程进度<strong>{course.progress}</strong></span>
            </div>
            <div className={styles.progressTrack}><i style={{ width: course.progress }} /></div>
            <div className={styles.cardFooter}><span>下一项：{course.next}</span><Link to="/experiments">进入课程 <ArrowRight size={12} /></Link></div>
          </article>
        ))}
      </div>
    </div>
  );
}
