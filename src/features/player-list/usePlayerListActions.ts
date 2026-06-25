import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { openUserDialog } from '@/services/dialogService';
import { resolveUserByDisplayName } from '@/services/userIdentityService';
import { normalizeString } from '@/shared/utils/string';

import { buildPlayerDialogSeedData } from './playerListRows';

export function usePlayerListActions({ currentUserEndpoint }: any) {
    const { t } = useTranslation();

    const openPlayerRow = useCallback(
        async (row: any) => {
            const userId = normalizeString(
                row?.userId || row?.userRef?.id || row?.ref?.id
            );
            const displayName = normalizeString(
                row?.displayName ||
                    row?.userRef?.displayName ||
                    row?.ref?.displayName
            );
            const seedData = buildPlayerDialogSeedData(row);

            if (userId) {
                openUserDialog({ seedData, title: displayName, userId });
                return;
            }

            if (!displayName || displayName.startsWith('ID:')) {
                return;
            }

            try {
                const resolved = await resolveUserByDisplayName(displayName, {
                    endpoint: currentUserEndpoint
                });
                if (resolved?.userId) {
                    const resolvedSeedData =
                        resolved.seedData &&
                        typeof resolved.seedData === 'object'
                            ? resolved.seedData
                            : {};
                    openUserDialog({
                        seedData:
                            seedData || resolved.seedData
                                ? {
                                      ...resolvedSeedData,
                                      ...(seedData || {}),
                                      id: resolved.userId,
                                      userId: resolved.userId
                                  }
                                : null,
                        title: resolved.title || displayName,
                        userId: resolved.userId
                    });
                    return;
                }
                toast.info(
                    t(
                        'view.player_list.empty.no_user_id_was_found_for_this_player_row'
                    )
                );
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : t(
                              'view.player_list.toast.failed_to_look_up_this_player'
                          )
                );
            }
        },
        [currentUserEndpoint, t]
    );

    return { openPlayerRow };
}
