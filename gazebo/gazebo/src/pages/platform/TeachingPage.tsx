import { BookOpenCheck, ClipboardList, GraduationCap, LayoutTemplate, Trophy } from 'lucide-react';

import { usePlatformUiStore } from '../../stores/platformUiStore';
import styles from './PlatformPages.module.css';

const teachingFeatures = [
  { title: '实验模板管理', description: '配置实验目标、步骤、场景和安全约束。', icon: LayoutTemplate },
  { title: '课程管理', description: '组织课程与实验内容，规划教学进度。', icon: BookOpenCheck },
  { title: '学生实验', description: '查看学生实验状态、任务进度与异常事件。', icon: GraduationCap },
  { title: '成绩管理', description: '汇总训练成绩、完成率与教学反馈。', icon: Trophy },
] as const;

export function TeachingPage() {
  const showComingSoon = usePlatformUiStore((state) => state.showComingSoon);
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>教学管理</h1><p>教师端能力预览；每个入口均可操作，并统一反馈当前建设状态。</p></div>
        <span><ClipboardList size={16} />教师工作台</span>
      </header>
      <div className={styles.featureGrid}>
        {teachingFeatures.map(({ title, description, icon: Icon }) => (
          <button className={styles.featureCard} type="button" onClick={() => showComingSoon(title, `${title}将在教师系统服务接入后开放，当前 Demo 已预留统一入口。`)} key={title}>
            <Icon size={28} /><strong>{title}</strong><span>{description}</span><i>查看功能状态 →</i>
          </button>
        ))}
      </div>
    </div>
  );
}
