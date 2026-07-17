import { useGroupDialogState } from './useGroupDialogState';

export function useGroupDialogController(
    args: Parameters<typeof useGroupDialogState>[0]
) {
    return useGroupDialogState(args);
}
