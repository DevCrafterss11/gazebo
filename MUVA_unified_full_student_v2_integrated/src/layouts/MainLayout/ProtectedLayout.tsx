import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuthStore } from '../../stores/authStore';

export function ProtectedLayout() {
  const signedIn = useAuthStore((state) => state.signedIn);
  const location = useLocation();

  if (!signedIn) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
