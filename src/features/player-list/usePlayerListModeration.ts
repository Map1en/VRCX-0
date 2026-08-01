import { useEffect, useState } from 'react';

import vrchatModerationRepository from '@/repositories/vrchatModerationRepository';
import { subscribeModerationSyncChanges } from '@/services/moderationSyncService';
import { normalizeString } from '@/shared/utils/string';

type LocalModerationRow = Awaited<
    ReturnType<typeof vrchatModerationRepository.getAllLocalModerations>
>[number];

export function usePlayerListModeration(currentUserId: unknown) {
    const [moderationByUserId, setModerationByUserId] = useState<
        Record<string, LocalModerationRow>
    >({});

    const normalizedCurrentUserId = normalizeString(currentUserId);

    useEffect(() => {
        let active = true;
        let requestId = 0;

        if (!normalizedCurrentUserId) {
            setModerationByUserId({});
            return () => {
                active = false;
            };
        }

        const loadModerations = () => {
            const currentRequestId = ++requestId;
            vrchatModerationRepository
                .getAllLocalModerations(normalizedCurrentUserId)
                .then((rows) => {
                    if (!active || currentRequestId !== requestId) {
                        return;
                    }

                    setModerationByUserId(
                        Object.fromEntries(
                            rows
                                .filter((row) => normalizeString(row.userId))
                                .map((row) => [
                                    normalizeString(row.userId),
                                    row
                                ])
                        )
                    );
                })
                .catch(() => {
                    if (active && currentRequestId === requestId) {
                        setModerationByUserId({});
                    }
                });
        };

        loadModerations();
        const unsubscribe = subscribeModerationSyncChanges((change) => {
            if (
                !change.ownerUserId ||
                change.ownerUserId === normalizedCurrentUserId
            ) {
                loadModerations();
            }
        });

        return () => {
            active = false;
            unsubscribe();
        };
    }, [normalizedCurrentUserId]);

    return moderationByUserId;
}
