import { httpClient } from './http/client';
import type {
  AdminCourse,
  AdminListResult,
  AdminUser,
  AdminUserRole,
  AdminUserStatus,
  AuditLogEntry,
  CourseStatus,
  CreateAdminCourseInput,
  CreateAdminUserInput,
  ResourceStatus,
  SimulationResource,
  UpdateAdminCourseInput,
  UpdateAdminUserInput,
} from '../types/admin';

export interface AdminUserQuery {
  keyword?: string;
  role?: AdminUserRole | 'all';
  status?: AdminUserStatus | 'all';
}

export interface AdminCourseQuery {
  keyword?: string;
  semester?: string | 'all';
  status?: CourseStatus | 'all';
}

export interface AdminResourceQuery {
  keyword?: string;
  status?: ResourceStatus | 'all';
  node?: string | 'all';
}

export interface AdminLogQuery {
  keyword?: string;
  module?: string | 'all';
  result?: '成功' | '告警' | '失败' | 'all';
}

export interface AdminApi {
  listUsers(query?: AdminUserQuery): Promise<AdminListResult<AdminUser>>;
  createUser(input: CreateAdminUserInput): Promise<AdminUser>;
  updateUser(id: string, input: UpdateAdminUserInput): Promise<AdminUser>;

  listCourses(query?: AdminCourseQuery): Promise<AdminListResult<AdminCourse>>;
  createCourse(input: CreateAdminCourseInput): Promise<AdminCourse>;
  updateCourse(id: string, input: UpdateAdminCourseInput): Promise<AdminCourse>;
  listCourseMembers(courseId: string): Promise<string[]>;
  updateCourseMembers(courseId: string, studentIds: string[]): Promise<string[]>;

  listResources(query?: AdminResourceQuery): Promise<AdminListResult<SimulationResource>>;
  restartResource(id: string): Promise<SimulationResource>;
  stopResource(id: string): Promise<SimulationResource>;

  listLogs(query?: AdminLogQuery): Promise<AdminListResult<AuditLogEntry>>;
}

const wait = (ms = 120) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const nowText = () => new Date().toLocaleString('zh-CN', { hour12: false }).replaceAll('/', '-');

let mockUsers: AdminUser[] = [
  { id: 'u-admin-01', name: '系统管理员', username: 'admin01', role: 'admin', organization: '平台运维', status: 'active', createdAt: '2026-08-20 09:00' },
  { id: 'u-teacher-01', name: '张老师', username: 'teacher01', role: 'teacher', organization: '无人机飞行控制', status: 'active', createdAt: '2026-08-25 10:12' },
  { id: 'u-teacher-02', name: '李老师', username: 'teacher02', role: 'teacher', organization: '无人机任务规划', status: 'active', createdAt: '2026-08-25 10:18' },
  { id: 'u-student-01', name: '张三', username: 'student01', role: 'student', organization: '软件工程1班', status: 'active', createdAt: '2026-09-01 08:42' },
  { id: 'u-student-02', name: '李四', username: 'student02', role: 'student', organization: '软件工程1班', status: 'active', createdAt: '2026-09-01 08:43' },
  { id: 'u-student-03', name: '王五', username: 'student03', role: 'student', organization: '自动化2班', status: 'disabled', createdAt: '2026-09-01 08:46' },
];

let mockCourses: AdminCourse[] = [
  { id: 'c-001', code: 'UAV-FC-2026', name: '无人机飞行控制', teacherId: 'u-teacher-01', teacherName: '张老师', className: '软件工程1班', semester: '2026 秋季学期', studentCount: 42, experimentCount: 6, status: '进行中' },
  { id: 'c-002', code: 'UAV-MP-2026', name: '无人机任务规划', teacherId: 'u-teacher-02', teacherName: '李老师', className: '自动化2班', semester: '2026 秋季学期', studentCount: 38, experimentCount: 5, status: '进行中' },
  { id: 'c-003', code: 'UAV-SW-2026', name: '无人机集群控制', teacherId: 'u-teacher-01', teacherName: '张老师', className: '人工智能1班', semester: '2026 秋季学期', studentCount: 36, experimentCount: 4, status: '未开始' },
  { id: 'c-004', code: 'UAV-SEC-2026', name: '无人机安全实验', teacherId: 'u-teacher-02', teacherName: '李老师', className: '网络安全1班', semester: '2026 秋季学期', studentCount: 34, experimentCount: 4, status: '进行中' },
];

let mockCourseMembers: Record<string, string[]> = {
  'c-001': ['u-student-01', 'u-student-02'],
  'c-002': ['u-student-03'],
  'c-003': [],
  'c-004': [],
};

let mockResources: SimulationResource[] = [
  { id: 'SIM-001', node: 'NODE-A', ownerAccount: 'student01', experimentName: '基础飞行控制', runtime: 'Gazebo + Copter', cpu: 22, memory: 31, startedAt: '2026-09-14 14:21', status: 'RUNNING' },
  { id: 'SIM-002', node: 'NODE-A', ownerAccount: 'student02', experimentName: '基础飞行控制', runtime: 'Gazebo + Copter', cpu: 19, memory: 28, startedAt: '2026-09-14 14:26', status: 'RUNNING' },
  { id: 'SIM-003', node: 'NODE-B', ownerAccount: 'student08', experimentName: '航点任务规划', runtime: 'Gazebo + Copter', cpu: 26, memory: 35, startedAt: '2026-09-14 14:12', status: 'RUNNING' },
  { id: 'SIM-004', node: 'NODE-B', ownerAccount: '--', experimentName: '--', runtime: '资源池', cpu: 2, memory: 8, startedAt: null, status: 'IDLE' },
  { id: 'SIM-005', node: 'NODE-C', ownerAccount: 'student18', experimentName: 'PID 参数调节', runtime: 'Gazebo + Copter', cpu: 41, memory: 47, startedAt: '2026-09-14 13:48', status: 'WARNING' },
];

const mockLogs: AuditLogEntry[] = [
  { id: 'log-1', time: '2026-09-14 14:28:36', account: 'teacher01', module: '实验管理', action: '发布实验「航点任务规划」', result: '成功', ip: '10.20.4.18' },
  { id: 'log-2', time: '2026-09-14 14:21:08', account: 'student01', module: '仿真资源', action: '申请并启动 SIM-001', result: '成功', ip: '10.20.8.31' },
  { id: 'log-3', time: '2026-09-14 13:58:42', account: 'admin01', module: '用户管理', action: '停用账号 student03', result: '成功', ip: '10.20.1.6' },
  { id: 'log-4', time: '2026-09-14 13:46:15', account: 'system', module: '资源调度', action: 'SIM-006 启动超时，已释放容器', result: '告警', ip: '127.0.0.1' },
  { id: 'log-5', time: '2026-09-14 11:06:22', account: 'admin01', module: '课程管理', action: '调整课程「无人机飞行控制」任课教师', result: '成功', ip: '10.20.1.6' },
  { id: 'log-6', time: '2026-09-14 09:42:17', account: 'system', module: '系统服务', action: 'MAVLink Gateway 健康检查恢复', result: '成功', ip: '127.0.0.1' },
];

const applyUserQuery = (items: AdminUser[], query?: AdminUserQuery) => {
  const keyword = query?.keyword?.trim().toLowerCase();
  return items.filter((item) => {
    const matchesKeyword = !keyword || `${item.name}${item.username}${item.organization}`.toLowerCase().includes(keyword);
    const matchesRole = !query?.role || query.role === 'all' || item.role === query.role;
    const matchesStatus = !query?.status || query.status === 'all' || item.status === query.status;
    return matchesKeyword && matchesRole && matchesStatus;
  });
};

const applyCourseQuery = (items: AdminCourse[], query?: AdminCourseQuery) => {
  const keyword = query?.keyword?.trim().toLowerCase();
  return items.filter((item) => {
    const matchesKeyword = !keyword || `${item.code}${item.name}${item.teacherName}${item.className}`.toLowerCase().includes(keyword);
    const matchesSemester = !query?.semester || query.semester === 'all' || item.semester === query.semester;
    const matchesStatus = !query?.status || query.status === 'all' || item.status === query.status;
    return matchesKeyword && matchesSemester && matchesStatus;
  });
};

const applyResourceQuery = (items: SimulationResource[], query?: AdminResourceQuery) => {
  const keyword = query?.keyword?.trim().toLowerCase();
  return items.filter((item) => {
    const matchesKeyword = !keyword || `${item.id}${item.ownerAccount}${item.experimentName}${item.runtime}`.toLowerCase().includes(keyword);
    const matchesStatus = !query?.status || query.status === 'all' || item.status === query.status;
    const matchesNode = !query?.node || query.node === 'all' || item.node === query.node;
    return matchesKeyword && matchesStatus && matchesNode;
  });
};

const applyLogQuery = (items: AuditLogEntry[], query?: AdminLogQuery) => {
  const keyword = query?.keyword?.trim().toLowerCase();
  return items.filter((item) => {
    const matchesKeyword = !keyword || `${item.account}${item.module}${item.action}${item.ip}`.toLowerCase().includes(keyword);
    const matchesModule = !query?.module || query.module === 'all' || item.module === query.module;
    const matchesResult = !query?.result || query.result === 'all' || item.result === query.result;
    return matchesKeyword && matchesModule && matchesResult;
  });
};

const mockAdminApi: AdminApi = {
  async listUsers(query) {
    await wait();
    const items = applyUserQuery(mockUsers, query);
    return { items, total: items.length };
  },
  async createUser(input) {
    await wait();
    if (mockUsers.some((item) => item.username === input.username)) throw new Error('账号已存在');
    const created: AdminUser = {
      id: `u-${Date.now()}`,
      name: input.name,
      username: input.username,
      role: input.role,
      organization: input.organization,
      status: 'active',
      createdAt: nowText(),
    };
    mockUsers = [created, ...mockUsers];
    return created;
  },
  async updateUser(id, input) {
    await wait();
    const current = mockUsers.find((item) => item.id === id);
    if (!current) throw new Error('用户不存在');
    const updated = { ...current, ...input };
    mockUsers = mockUsers.map((item) => item.id === id ? updated : item);
    return updated;
  },
  async listCourses(query) {
    await wait();
    const items = applyCourseQuery(mockCourses, query);
    return { items, total: items.length };
  },
  async createCourse(input) {
    await wait();
    if (mockCourses.some((item) => item.code === input.code)) throw new Error('课程编号已存在');
    const created: AdminCourse = {
      id: `c-${Date.now()}`,
      ...input,
      studentCount: 0,
      experimentCount: 0,
    };
    mockCourses = [created, ...mockCourses];
    return created;
  },
  async updateCourse(id, input) {
    await wait();
    const current = mockCourses.find((item) => item.id === id);
    if (!current) throw new Error('课程不存在');
    const updated = { ...current, ...input };
    mockCourses = mockCourses.map((item) => item.id === id ? updated : item);
    return updated;
  },
  async listCourseMembers(courseId) {
    await wait();
    return [...(mockCourseMembers[courseId] ?? [])];
  },
  async updateCourseMembers(courseId, studentIds) {
    await wait();
    mockCourseMembers = { ...mockCourseMembers, [courseId]: [...studentIds] };
    return [...studentIds];
  },
  async listResources(query) {
    await wait();
    const items = applyResourceQuery(mockResources, query);
    return { items, total: items.length };
  },
  async restartResource(id) {
    await wait(260);
    const current = mockResources.find((item) => item.id === id);
    if (!current) throw new Error('仿真实例不存在');
    const updated: SimulationResource = { ...current, status: 'RUNNING', startedAt: nowText(), cpu: Math.max(current.cpu, 8) };
    mockResources = mockResources.map((item) => item.id === id ? updated : item);
    return updated;
  },
  async stopResource(id) {
    await wait(220);
    const current = mockResources.find((item) => item.id === id);
    if (!current) throw new Error('仿真实例不存在');
    const updated: SimulationResource = { ...current, status: 'IDLE', ownerAccount: '--', experimentName: '--', startedAt: null, cpu: 2, memory: 8 };
    mockResources = mockResources.map((item) => item.id === id ? updated : item);
    return updated;
  },
  async listLogs(query) {
    await wait();
    const items = applyLogQuery(mockLogs, query);
    return { items, total: items.length };
  },
};

/**
 * 预留的正式后端实现。
 * 默认不会启用，只有设置 VITE_ADMIN_DATA_SOURCE=api 时才调用这些接口，
 * 因此不会影响目前已经打通的无人机仿真后端。
 *
 * 约定接口：
 * GET/POST       /admin/users
 * PATCH          /admin/users/:id
 * GET/POST       /admin/courses
 * PATCH          /admin/courses/:id
 * GET/PUT         /admin/courses/:id/students
 * GET            /admin/simulation-resources
 * POST           /admin/simulation-resources/:id/restart
 * POST           /admin/simulation-resources/:id/stop
 * GET            /admin/audit-logs
 */
const apiAdminApi: AdminApi = {
  async listUsers(query) {
    const { data } = await httpClient.get<AdminListResult<AdminUser>>('/admin/users', { params: query });
    return data;
  },
  async createUser(input) {
    const { data } = await httpClient.post<AdminUser>('/admin/users', input);
    return data;
  },
  async updateUser(id, input) {
    const { data } = await httpClient.patch<AdminUser>(`/admin/users/${id}`, input);
    return data;
  },
  async listCourses(query) {
    const { data } = await httpClient.get<AdminListResult<AdminCourse>>('/admin/courses', { params: query });
    return data;
  },
  async createCourse(input) {
    const { data } = await httpClient.post<AdminCourse>('/admin/courses', input);
    return data;
  },
  async updateCourse(id, input) {
    const { data } = await httpClient.patch<AdminCourse>(`/admin/courses/${id}`, input);
    return data;
  },
  async listCourseMembers(courseId) {
    const { data } = await httpClient.get<{ studentIds: string[] }>(`/admin/courses/${courseId}/students`);
    return data.studentIds;
  },
  async updateCourseMembers(courseId, studentIds) {
    const { data } = await httpClient.put<{ studentIds: string[] }>(`/admin/courses/${courseId}/students`, { studentIds });
    return data.studentIds;
  },
  async listResources(query) {
    const { data } = await httpClient.get<AdminListResult<SimulationResource>>('/admin/simulation-resources', { params: query });
    return data;
  },
  async restartResource(id) {
    const { data } = await httpClient.post<SimulationResource>(`/admin/simulation-resources/${id}/restart`);
    return data;
  },
  async stopResource(id) {
    const { data } = await httpClient.post<SimulationResource>(`/admin/simulation-resources/${id}/stop`);
    return data;
  },
  async listLogs(query) {
    const { data } = await httpClient.get<AdminListResult<AuditLogEntry>>('/admin/audit-logs', { params: query });
    return data;
  },
};

export const adminApi: AdminApi = import.meta.env.VITE_ADMIN_DATA_SOURCE === 'api' ? apiAdminApi : mockAdminApi;
