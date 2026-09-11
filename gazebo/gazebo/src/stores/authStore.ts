import { create } from 'zustand';

interface AuthState {
  signedIn: boolean;
  displayName: string;
  login: () => void;
  logout: () => void;
}

const sessionKey = 'muva-mock-user';
const initialSignedIn = sessionStorage.getItem(sessionKey) !== 'signed-out';

export const useAuthStore = create<AuthState>((set) => ({
  signedIn: initialSignedIn,
  displayName: 'admin',
  login: () => {
    sessionStorage.setItem(sessionKey, 'signed-in');
    set({ signedIn: true });
  },
  logout: () => {
    sessionStorage.setItem(sessionKey, 'signed-out');
    set({ signedIn: false });
  },
}));
