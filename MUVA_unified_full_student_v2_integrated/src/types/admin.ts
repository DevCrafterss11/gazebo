export type AdminUserRole = 'admin' | 'teacher' | 'student';
export type AdminUserStatus = 'active' | 'disabled';
export type CourseStatus = '未开始' | '进行中' | '已结束';
export type ResourceStatus = 'RUNNING' | 'IDLE' | 'WARNING' | 'STOPPED';
export type AuditResult = '成功' | '告警' | '失败';

export interface AdminUser {
  id: string;
  name: string;
  username: string;
  role: AdminUserRole;
  organization: string;
  status: AdminUserStatus;
  createdAt: string;
}

export interface CreateAdminUserInput {
  name: string;
  username: string;
  role: AdminUserRole;
  organization: string;
  password: string;
}

export interface UpdateAdminUserInput {
  name?: string;
  role?: AdminUserRole;
  organization?: string;
  status?: AdminUserStatus;
}

export interface AdminCourse {
  id: string;
  code: string;
  name: string;
  teacherId: string;
  teacherName: string;
  className: string;
  semester: string;
  studentCount: number;
  experimentCount: number;
  status: CourseStatus;
}

export interface CreateAdminCourseInput {
  code: string;
  name: string;
  teacherId: string;
  teacherName: string;
  className: string;
  semester: string;
  status: CourseStatus;
}

export interface UpdateAdminCourseInput {
  name?: string;
  teacherId?: string;
  teacherName?: string;
  className?: string;
  semester?: string;
  status?: CourseStatus;
}

export interface SimulationResource {
  id: string;
  node: string;
  ownerAccount: string;
  experimentName: string;
  runtime: string;
  cpu: number;
  memory: number;
  startedAt: string | null;
  status: ResourceStatus;
}

export interface AuditLogEntry {
  id: string;
  time: string;
  account: string;
  module: string;
  action: string;
  result: AuditResult;
  ip: string;
}

export interface AdminListResult<T> {
  items: T[];
  total: number;
}
