import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { BotSettings, SettingsSection } from './types';
import { useToast } from '../components/ui';

interface SettingsResponse {
  settings: BotSettings;
  ownerId: string | null;
  restartSections: SettingsSection[];
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsResponse>('/api/settings') });
}

type SaveVariables = {
  [K in SettingsSection]: { section: K; value: BotSettings[K]; silent?: boolean };
}[SettingsSection];

interface SaveResult {
  settings: BotSettings;
  restartRequired: boolean;
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation<SaveResult, Error, SaveVariables>({
    mutationFn: ({ section, value }) => api.put<SaveResult>(`/api/settings/${section}`, value),
    onSuccess: (result, variables) => {
      queryClient.setQueryData<SettingsResponse>(['settings'], old => (old ? { ...old, settings: result.settings } : old));
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      if (!variables.silent) {
        toast.success(result.restartRequired ? 'Saved. Restart the bot to apply this change.' : 'Settings saved');
      }
    },
    onError: (error) => toast.error(error)
  });
}
