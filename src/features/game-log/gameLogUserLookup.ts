// @ts-nocheck
import { toast } from 'sonner';

import { openUserDialog } from '@/services/dialogService.js';
import { resolveUserByDisplayName } from '@/services/userIdentityService.js';

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
        const resolved = await resolveUserByDisplayName(displayName, {
            search: !displayName.startsWith('ID:')
        });
        if (resolved?.userId) {
            openUserDialog({
                userId: resolved.userId,
                title: resolved.title || displayName,
                seedData: resolved.seedData || null
            });
            return;
        }

        toast.info(
            t(
                'view.game_log.dynamic.no_user_id_was_found_for_value',
                { value: displayName }
            )
        );
    } catch (error) {
        toast.error(
            error instanceof Error
                ? error.message
                : t('view.game_log.toast.failed_to_look_up_value', {
                      value: displayName
                  })
        );
    }
}
