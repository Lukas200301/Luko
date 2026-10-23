import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { AuthConfig, PanelUser } from './types';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ user: PanelUser | null }>('/api/auth/me'),
    staleTime: 60_000
  });
}

export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api.get<AuthConfig>('/api/auth/config'),
    staleTime: 5 * 60_000
  });
}

export async function logout() {
  await api.post('/api/auth/logout');
  window.location.href = '/login';
}
