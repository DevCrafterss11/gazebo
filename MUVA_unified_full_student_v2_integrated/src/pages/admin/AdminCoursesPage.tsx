import { BookOpenCheck, Pencil, Plus, Search, UserPlus, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Modal } from '../../components/common/Modal/Modal';
import { adminApi } from '../../services/adminApi';
import type { AdminCourse, AdminUser, CourseStatus, CreateAdminCourseInput } from '../../types/admin';
import styles from '../role/RolePages.module.css';

export function AdminCoursesPage() {
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [teachers, setTeachers] = useState<AdminUser[]>([]);
  const [students, setStudents] = useState<AdminUser[]>([]);
  const [keyword, setKeyword] = useState('');
  const [semester, setSemester] = useState('all');
  const [status, setStatus] = useState<CourseStatus | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminCourse | null>(null);
  const [memberCourse, setMemberCourse] = useState<AdminCourse | null>(null);
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [courseResult, teacherResult, studentResult] = await Promise.all([
          adminApi.listCourses(),
          adminApi.listUsers({ role: 'teacher', status: 'active' }),
          adminApi.listUsers({ role: 'student', status: 'active' }),
        ]);
        setCourses(courseResult.items);
        setTeachers(teacherResult.items);
        setStudents(studentResult.items);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : '课程数据加载失败');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const semesters = useMemo(() => Array.from(new Set(courses.map((item) => item.semester))), [courses]);
  const filtered = useMemo(() => courses.filter((item) => {
    const text = `${item.code}${item.name}${item.teacherName}${item.className}`.toLowerCase();
    return (!keyword.trim() || text.includes(keyword.trim().toLowerCase()))
      && (semester === 'all' || item.semester === semester)
      && (status === 'all' || item.status === status);
  }), [courses, keyword, semester, status]);

  const totals = useMemo(() => ({
    courses: courses.length,
    running: courses.filter((item) => item.status === '进行中').length,
    students: courses.reduce((sum, item) => sum + item.studentCount, 0),
    experiments: courses.reduce((sum, item) => sum + item.experimentCount, 0),
  }), [courses]);

  const createCourse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const teacherId = String(form.get('teacherId') ?? '');
    const teacher = teachers.find((item) => item.id === teacherId);
    const input: CreateAdminCourseInput = {
      code: String(form.get('code') ?? '').trim(),
      name: String(form.get('name') ?? '').trim(),
      teacherId,
      teacherName: teacher?.name ?? '',
      className: String(form.get('className') ?? '').trim(),
      semester: String(form.get('semester') ?? '').trim(),
      status: String(form.get('status') ?? '未开始') as CourseStatus,
    };
    if (!input.code || !input.name || !input.teacherId || !input.className || !input.semester) {
      setError('请完整填写课程信息。');
      return;
    }
    try {
      const created = await adminApi.createCourse(input);
      setCourses((items) => [created, ...items]);
      setCreating(false);
      setError('');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '创建课程失败');
    }
  };

  const updateCourse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const teacherId = String(form.get('teacherId') ?? editing.teacherId);
    const teacher = teachers.find((item) => item.id === teacherId);
    try {
      const updated = await adminApi.updateCourse(editing.id, {
        name: String(form.get('name') ?? editing.name).trim(),
        teacherId,
        teacherName: teacher?.name ?? editing.teacherName,
        className: String(form.get('className') ?? editing.className).trim(),
        semester: String(form.get('semester') ?? editing.semester).trim(),
        status: String(form.get('status') ?? editing.status) as CourseStatus,
      });
      setCourses((items) => items.map((item) => item.id === updated.id ? updated : item));
      setEditing(null);
      setError('');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '课程更新失败');
    }
  };


  const openMembers = async (course: AdminCourse) => {
    setMemberCourse(course);
    setError('');
    try {
      const memberIds = await adminApi.listCourseMembers(course.id);
      setSelectedMembers(memberIds);
    } catch (memberError) {
      setError(memberError instanceof Error ? memberError.message : '课程成员加载失败');
    }
  };

  const saveMembers = async () => {
    if (!memberCourse) return;
    try {
      await adminApi.updateCourseMembers(memberCourse.id, selectedMembers);
      setMemberCourse(null);
      setError('');
    } catch (memberError) {
      setError(memberError instanceof Error ? memberError.message : '课程成员保存失败');
    }
  };

  return (
    <section className={styles.rolePage}>
      <header className={styles.compactHeader}>
        <div><h1>课程管理</h1><p>维护全平台课程、任课教师和教学班关系；只展示教学组织信息，不进入学生个人实验数据。</p></div>
        <span><BookOpenCheck size={14} /> 课程与教学班</span>
      </header>

      <section className={`${styles.panel} ${styles.adminSummaryPanel}`}>
        <div className={styles.miniSummaryGrid}>
          <div><span>演示课程</span><strong>{totals.courses}</strong><small>后端接入后显示平台总数</small></div>
          <div><span>进行中</span><strong>{totals.running}</strong><small>当前学期已开课课程</small></div>
          <div><span>教学班人数</span><strong>{totals.students}</strong><small>仅汇总数量，不展示实验详情</small></div>
          <div><span>实验配置</span><strong>{totals.experiments}</strong><small>管理员可进入实验管理修改定义</small></div>
        </div>
      </section>

      <div className={styles.toolbar}>
        <div className={styles.filters}>
          <label className={styles.search}><Search size={13} /><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索课程 / 编号 / 教师" /></label>
          <select className={styles.filter} value={semester} onChange={(event) => setSemester(event.target.value)}><option value="all">全部学期</option>{semesters.map((item) => <option value={item} key={item}>{item}</option>)}</select>
          <select className={styles.filter} value={status} onChange={(event) => setStatus(event.target.value as CourseStatus | 'all')}><option value="all">全部状态</option><option value="未开始">未开始</option><option value="进行中">进行中</option><option value="已结束">已结束</option></select>
        </div>
        <button className={styles.primaryButton} type="button" onClick={() => { setCreating(true); setError(''); }}><Plus size={14} />创建课程</button>
      </div>

      {error ? <div className={styles.pageMessage}>{error}</div> : null}

      <section className={styles.panel}>
        <div className={styles.panelHeader}><div className={styles.panelTitle}><BookOpenCheck size={16} />课程列表</div><span className={styles.panelSubtle}>当前筛选 {filtered.length} 项</span></div>
        <div className={styles.dataTable}>
          <div className={`${styles.tableHead} ${styles.adminCoursesV2}`}><span>课程</span><span>任课教师</span><span>教学班</span><span>学生</span><span>实验</span><span>状态</span><span>操作</span></div>
          {loading ? <div className={styles.emptyHint}>正在加载课程数据…</div> : filtered.map((course) => (
            <div className={`${styles.tableRow} ${styles.adminCoursesV2}`} key={course.id}>
              <div className={styles.identityCopy}><strong>{course.name}</strong><span>{course.code} · {course.semester}</span></div>
              <span>{course.teacherName}</span>
              <span>{course.className}</span>
              <span><Users size={12} className={styles.inlineIcon} /> {course.studentCount} 人</span>
              <span>{course.experimentCount} 个</span>
              <span className={`${styles.statusPill} ${course.status === '进行中' ? styles.success : course.status === '未开始' ? styles.warning : ''}`}>{course.status}</span>
              <div className={styles.rowActions}><button className={styles.iconAction} title="课程成员" type="button" onClick={() => void openMembers(course)}><UserPlus size={13} /></button><button className={styles.iconAction} title="编辑课程" type="button" onClick={() => { setEditing(course); setError(''); }}><Pencil size={13} /></button></div>
            </div>
          ))}
          {!loading && filtered.length === 0 ? <div className={styles.emptyHint}>没有符合条件的课程</div> : null}
        </div>
      </section>

      {creating ? (
        <Modal title="创建课程" description="管理员先建立课程与任课教师关系，教师端再负责实验发布和学生教学过程。" onClose={() => setCreating(false)} width="wide">
          <form className={styles.adminForm} onSubmit={createCourse}>
            <div className={styles.formGrid}>
              <label>课程名称<input name="name" placeholder="例如：无人机自主导航" autoFocus /></label>
              <label>课程编号<input name="code" placeholder="例如：UAV-NAV-2026" /></label>
              <label>任课教师<select name="teacherId" defaultValue=""><option value="" disabled>请选择教师</option>{teachers.map((teacher) => <option value={teacher.id} key={teacher.id}>{teacher.name} · {teacher.username}</option>)}</select></label>
              <label>教学班<input name="className" placeholder="例如：自动化3班" /></label>
              <label>学期<input name="semester" defaultValue="2026 秋季学期" /></label>
              <label>课程状态<select name="status" defaultValue="未开始"><option>未开始</option><option>进行中</option><option>已结束</option></select></label>
            </div>
            <div className={styles.formHint}>预留接口：POST /api/admin/courses。学生名单后续可通过班级关联或批量导入接口补充。</div>
            <div className={styles.formActions}><button className={styles.ghostButton} type="button" onClick={() => setCreating(false)}>取消</button><button className={styles.primaryButton} type="submit">创建课程</button></div>
          </form>
        </Modal>
      ) : null}

      {memberCourse ? (
        <Modal title={`课程成员 · ${memberCourse.name}`} description={`${memberCourse.className} · 正式后端可分页加载整班学生，当前仅展示演示账号。`} onClose={() => setMemberCourse(null)} width="regular">
          <div className={styles.memberPicker}>
            <div className={styles.memberPickerHeader}><span>选择加入课程的学生账号</span><strong>{selectedMembers.length} 个演示账号已选择</strong></div>
            <div className={styles.memberList}>
              {students.map((student) => {
                const checked = selectedMembers.includes(student.id);
                return <label key={student.id}><input type="checkbox" checked={checked} onChange={() => setSelectedMembers((current) => checked ? current.filter((id) => id !== student.id) : [...current, student.id])} /><span className={styles.avatar}>{student.name.slice(0, 1)}</span><span><strong>{student.name}</strong><small>{student.username} · {student.organization}</small></span></label>;
              })}
            </div>
            <div className={styles.formHint}>预留接口：GET / PUT /api/admin/courses/{memberCourse.id}/students。管理员只管理选课关系，不读取这些学生的实验记录。</div>
            <div className={styles.formActions}><button className={styles.ghostButton} type="button" onClick={() => setMemberCourse(null)}>取消</button><button className={styles.primaryButton} type="button" onClick={() => void saveMembers()}>保存成员</button></div>
          </div>
        </Modal>
      ) : null}

      {editing ? (
        <Modal title={`编辑课程 · ${editing.name}`} description={`${editing.code} · 当前 ${editing.studentCount} 名学生 / ${editing.experimentCount} 个实验`} onClose={() => setEditing(null)} width="wide">
          <form className={styles.adminForm} onSubmit={updateCourse}>
            <div className={styles.formGrid}>
              <label>课程名称<input name="name" defaultValue={editing.name} /></label>
              <label>课程编号<input value={editing.code} disabled /></label>
              <label>任课教师<select name="teacherId" defaultValue={editing.teacherId}>{teachers.map((teacher) => <option value={teacher.id} key={teacher.id}>{teacher.name} · {teacher.username}</option>)}</select></label>
              <label>教学班<input name="className" defaultValue={editing.className} /></label>
              <label>学期<input name="semester" defaultValue={editing.semester} /></label>
              <label>课程状态<select name="status" defaultValue={editing.status}><option>未开始</option><option>进行中</option><option>已结束</option></select></label>
            </div>
            <div className={styles.formActions}><button className={styles.ghostButton} type="button" onClick={() => setEditing(null)}>取消</button><button className={styles.primaryButton} type="submit">保存课程</button></div>
          </form>
        </Modal>
      ) : null}
    </section>
  );
}
