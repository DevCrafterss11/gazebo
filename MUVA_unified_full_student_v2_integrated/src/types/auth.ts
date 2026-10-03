export type UserRole = 'admin' | 'teacher' | 'student';

export interface LoginCredentials {
  username: string;
  password: string;
  role: UserRole;
}

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  permissions: string[];
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}
