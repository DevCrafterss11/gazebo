import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { getRoleHomePath, type UserRole, useAuthStore } from '../../stores/authStore';

interface RoleGuardProps {
  allowed: readonly UserRole[];
  children: ReactNode;
}

export function RoleGuard({ allowed, children }: RoleGuardProps) {
  const role = useAuthStore((state) => state.role);

  if (!allowed.includes(role)) {
    return <Navigate to={getRoleHomePath(role)} replace />;
  }

  return <>{children}</>;
}

export function RoleHomeRedirect() {
  const role = useAuthStore((state) => state.role);
  return <Navigate to={getRoleHomePath(role)} replace />;
}
