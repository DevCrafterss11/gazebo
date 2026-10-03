import { httpClient } from './http/client';
import type { LoginCredentials, LoginResponse, UserRole } from '../types/auth';

export interface AuthApi {
  login(credentials: LoginCredentials): Promise<LoginResponse>;
  getCurrentUser(): Promise<LoginResponse['user']>;
}

export const demoAccounts: Record<UserRole, { username: string; password: string; displayName: string }> = {
  admin: { username: 'admin01', password: 'admin123', displayName: '系统管理员' },
  teacher: { username: 'teacher01', password: 'teacher123', displayName: '张老师' },
  student: { username: 'student01', password: 'student123', displayName: '张三' },
};

const mockPermissions: Record<UserRole, string[]> = {
  admin: ['user:manage', 'course:manage', 'experiment:definition', 'resource:manage', 'audit:view'],
  teacher: ['course:view', 'experiment:manage', 'student:records', 'grade:manage', 'simulation:demo'],
  student: ['course:view', 'experiment:execute', 'record:self', 'report:self', 'grade:self'],
};

const mockAuthApi: AuthApi = {
  async login(credentials) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 160));
    const account = demoAccounts[credentials.role];
    if (credentials.username.trim() !== account.username || credentials.password !== account.password) {
      throw new Error('账号、密码或所选角色不匹配，请检查后重试。');
    }
    return {
      token: `mock-token-${credentials.role}`,
      user: {
        id: `mock-${credentials.role}-001`,
        username: account.username,
        displayName: account.displayName,
        role: credentials.role,
        permissions: mockPermissions[credentials.role],
      },
    };
  },
  async getCurrentUser() {
    throw new Error('Mock 模式下用户信息由会话状态恢复');
  },
};

const apiAuthApi: AuthApi = {
  async login(credentials) {
    const { data } = await httpClient.post<LoginResponse>('/auth/login', credentials);
    return data;
  },
  async getCurrentUser() {
    const { data } = await httpClient.get<LoginResponse['user']>('/auth/me');
    return data;
  },
};

export const authApi: AuthApi = import.meta.env.VITE_AUTH_DATA_SOURCE === 'api' ? apiAuthApi : mockAuthApi;
