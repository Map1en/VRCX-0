import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { hasAnyGroupModerationPermission } from '@/components/dialogs/group-dialog/groupDialogUtils';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import type { UserGroupsOverviewGroup } from '@/platform/tauri/bindings';
import groupProfileRepository from '@/repositories/groupProfileRepository';

export type ModeratableGroupsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type UseModeratableGroupsOptions = {
    enabled?: boolean;
    currentUserId: string;
    endpoint: string;
};

export type UseModeratableGroupsResult = {
    status: ModeratableGroupsStatus;
    error: string;
    groups: UserGroupsOverviewGroup[];
    permissionsDegraded: boolean;
    reload: () => void;
};

export function useModeratableGroups({
    enabled = true,
    currentUserId,
    endpoint
}: UseModeratableGroupsOptions): UseModeratableGroupsResult {
    const { t } = useTranslation();
    const [status, setStatus] = useState<ModeratableGroupsStatus>('idle');
    const [error, setError] = useState('');
    const [groups, setGroups] = useState<UserGroupsOverviewGroup[]>([]);
    const [permissionsDegraded, setPermissionsDegraded] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);

    useEffect(() => {
        if (!enabled) {
            return;
        }

        if (!currentUserId) {
            setStatus('ready');
            setGroups([]);
            setPermissionsDegraded(false);
            return;
        }

        let active = true;
        setStatus('loading');
        setError('');
        groupProfileRepository
            .getUserGroupsOverview({ userId: currentUserId, endpoint })
            .then((output) => {
                if (!active) {
                    return;
                }
                setGroups(
                    output.groups.filter((group) =>
                        hasAnyGroupModerationPermission(group.permissions)
                    )
                );
                setPermissionsDegraded(output.permissionsDegraded);
                setStatus('ready');
            })
            .catch((requestError: unknown) => {
                if (!active) {
                    return;
                }
                setStatus('error');
                setError(
                    userFacingErrorMessage(
                        requestError,
                        t(
                            'host.tools_dialogs.toast.failed_to_load_moderatable_groups'
                        )
                    )
                );
            });

        return () => {
            active = false;
        };
    }, [enabled, currentUserId, endpoint, reloadToken, t]);

    return {
        status,
        error,
        groups,
        permissionsDegraded,
        reload: () => setReloadToken((token) => token + 1)
    };
}
