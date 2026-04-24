import { toast } from 'sonner';

import {
    gameLogRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import { openUserDialog } from '@/services/dialogService.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

export function normalizeId(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

export async function openGameLogUser(row, t) {
    const userId = normalizeId(row?.userId);
    const displayName = normalizeId(row?.displayName);
    if (userId) {
        openUserDialog({ userId, title: displayName || undefined });
        return;
    }
    if (!displayName) {
        return;
    }

    try {
        const lowerDisplayName = displayName.toLowerCase();
        const { auth } = useRuntimeStore.getState();
        const { friendsById } = useFriendRosterStore.getState();
        const localUser = [
            auth?.currentUserSnapshot,
            ...Object.values(friendsById || {})
        ].find((user) => {
            const name = normalizeId(
                user?.displayName || user?.username
            ).toLowerCase();
            return name && name === lowerDisplayName;
        });
        if (localUser?.id) {
            openUserDialog({
                userId: localUser.id,
                title: localUser.displayName || displayName,
                seedData: localUser
            });
            return;
        }

        const resolvedUserId = normalizeId(
            await gameLogRepository
                .getUserIdFromDisplayName(displayName)
                .catch(() => '')
        );
        if (resolvedUserId) {
            openUserDialog({ userId: resolvedUserId, title: displayName });
            return;
        }

        if (displayName.startsWith('ID:')) {
            toast.info(
                t(
                    'view.game_log.generated_dynamic.no_user_id_was_found_for_value',
                    { value: displayName }
                )
            );
            return;
        }

        const response = await vrchatSearchRepository.getUsers(
            {
                search: displayName,
                n: 5,
                offset: 0
            },
            { endpoint: auth?.currentUserEndpoint || '' }
        );
        const rows = Array.isArray(response.json) ? response.json : [];
        const match = rows.find(
            (user) =>
                normalizeId(user?.displayName).toLowerCase() ===
                lowerDisplayName
        );
        if (match?.id) {
            openUserDialog({
                userId: match.id,
                title: match.displayName || displayName,
                seedData: match
            });
            return;
        }
        toast.info(
            t(
                'view.game_log.generated_dynamic.no_user_id_was_found_for_value',
                { value: displayName }
            )
        );
    } catch (error) {
        toast.error(
            error instanceof Error
                ? error.message
                : t('view.game_log.generated_toast.failed_to_look_up_value', {
                      value: displayName
                  })
        );
    }
}
