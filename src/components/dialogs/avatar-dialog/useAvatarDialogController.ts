import type { AvatarDialogInput } from './avatarDialogTypes';
import { useAvatarDialogState } from './useAvatarDialogState';

export function useAvatarDialogController(args: AvatarDialogInput) {
    return useAvatarDialogState(args);
}
