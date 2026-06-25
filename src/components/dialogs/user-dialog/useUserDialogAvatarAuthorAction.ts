import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import { openUserDialog } from '@/services/dialogService';

export function useUserDialogAvatarAuthorAction({
    currentAvatarTarget,
    currentEndpoint
}: any) {
    const { t } = useTranslation();

    return async function showAvatarAuthor() {
        if (!currentAvatarTarget) {
            return;
        }
        try {
            const avatar = await avatarProfileRepository.getAvatarProfile({
                avatarId: currentAvatarTarget,
                endpoint: currentEndpoint
            });
            if (avatar.authorId) {
                openUserDialog({
                    userId: avatar.authorId,
                    title: avatar.authorName || undefined
                });
                return;
            }
            toast.error(t('dialog.user.error.avatar_author_unavailable'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : t('dialog.user.toast.failed_to_load_avatar_author')
            );
        }
    };
}
