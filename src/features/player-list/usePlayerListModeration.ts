import { useEffect, useState } from 'react';

import vrchatModerationRepository from '@/repositories/vrchatModerationRepository';
import { normalizeString } from '@/shared/utils/string';

export function usePlayerListModeration(currentUserId: any) {
    const [moderationByUserId, setModerationByUserId] = useState<any>({});

    useEffect(() => {
        let active = true;

        if (!currentUserId) {
            setModerationByUserId({});
            return () => {
                active = false;
            };
        }

        vrchatModerationRepository
            .getAllLocalModerations(currentUserId)
            .then((rows: any) => {
                if (!active) {
                    return;
                }

                setModerationByUserId(
                    Object.fromEntries(
                        (Array.isArray(rows) ? rows : [])
                            .filter((row: any) => normalizeString(row?.userId))
                            .map((row: any) => [
                                normalizeString(row.userId),
                                row
                            ])
                    )
                );
            })
            .catch(() => {
                if (active) {
                    setModerationByUserId({});
                }
            });

        return () => {
            active = false;
        };
    }, [currentUserId]);

    return moderationByUserId;
}
