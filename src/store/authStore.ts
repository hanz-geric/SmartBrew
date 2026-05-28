import { create } from 'zustand';
import { AuthUser } from '../types';

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  setUser: (user: AuthUser | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user:      null,
  isLoading: true,   // true until Firebase resolves the persisted session
  setUser:   (user) => set({ user, isLoading: false }),
}));
