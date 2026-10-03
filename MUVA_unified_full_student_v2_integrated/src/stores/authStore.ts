import { create } from 'zustand';

import { authApi, demoAccounts } from '../services/authApi';
import type { LoginCredentials, UserRole } from '../types/auth';

export type { UserRole } from '../types/auth';

interface LoginResult {
  ok: boolean;
  message?: string;
}

interface AuthState {
  signedIn: boolean;
  username: string;
  displayName: string;
  role: UserRole;
  permissions: string[];
  token: string;
  login: (credentials: LoginCredentials) => Promise<LoginResult>;
  logout: () => void;
}

const sessionKey = 'muva-mock-user';
const roleKey = 'muva-user-role';
const usernameKey = 'muva-username';
const displayNameKey = 'muva-display-name';
const tokenKey = 'muva-auth-token';
const permissionKey = 'muva-permissions';

const storedRole = sessionStorage.getItem(roleKey) as UserRole | null;
const initialRole: UserRole = storedRole && storedRole in demoAccounts ? storedRole : 'student';
const initialUsername = sessionStorage.getItem(usernameKey) ?? demoAccounts[initialRole].username;
const initialSignedIn = sessionStorage.getItem(sessionKey) === 'signed-in';

export const getRoleHomePath = (role: UserRole) => {
  if (role === 'admin') return '/admin/dashboard';
  if (role === 'teacher') return '/teacher/dashboard';
  return '/dashboard';
};

export const getDemoAccount = (role: UserRole) => demoAccounts[role];

export const useAuthStore = create<AuthState>((set) => ({
  signedIn: initialSignedIn,
  username: initialUsername,
  displayName: sessionStorage.getItem(displayNameKey) ?? demoAccounts[initialRole].displayName,
  role: initialRole,
  permissions: JSON.parse(sessionStorage.getItem(permissionKey) ?? '[]') as string[],
  token: sessionStorage.getItem(tokenKey) ?? '',
  login: async (credentials) => {
    try {
      const response = await authApi.login(credentials);
      sessionStorage.setItem(sessionKey, 'signed-in');
      sessionStorage.setItem(roleKey, response.user.role);
      sessionStorage.setItem(usernameKey, response.user.username);
      sessionStorage.setItem(displayNameKey, response.user.displayName);
      sessionStorage.setItem(tokenKey, response.token);
      sessionStorage.setItem(permissionKey, JSON.stringify(response.user.permissions));
      set({
        signedIn: true,
        username: response.user.username,
        displayName: response.user.displayName,
        role: response.user.role,
        permissions: response.user.permissions,
        token: response.token,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : '登录失败' };
    }
  },
  logout: () => {
    sessionStorage.removeItem(sessionKey);
    sessionStorage.removeItem(tokenKey);
    sessionStorage.removeItem(permissionKey);
    set({ signedIn: false, permissions: [], token: '' });
  },
}));
