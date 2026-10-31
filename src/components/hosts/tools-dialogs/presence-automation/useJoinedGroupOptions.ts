import { useEffect, useState } from 'react';

import { groupIdForRow } from '@/components/dialogs/user-dialog/userDialogGroupRows';
import groupProfileRepository from '@/repositories/groupProfileRepository';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { PresenceOption } from './presenceAutomationDialogUtils';

export function useJoinedGroupOptions(enabled: boolean): PresenceOption[] {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const [options, setOptions] = useState<PresenceOption[]>([]);

    useEffect(() => {
        if (!enabled || !currentUserId) {
            return;
        }
        let cancelled = false;
        groupProfileRepository
            .getUserGroups({ userId: currentUserId })
            .then((rows) => {
                if (cancelled) {
                    return;
                }
                setOptions(
                    rows
                        .map((row) => {
                            const value = groupIdForRow(row);
                            return { value, label: row.name || value };
                        })
                        .filter((option) => option.value)
                );
            })
            .catch(() => {
                if (!cancelled) {
                    setOptions([]);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [enabled, currentUserId]);

    return options;
}
