import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import type { UserGroupsOverviewGroup } from '@/platform/tauri/bindings';
import groupProfileRepository from '@/repositories/groupProfileRepository';

import { groupsForInvitePicker } from './userDialogGroupInviteGroups';

interface UserDialogGroupInviteGroupsInput {
    open: boolean;
    currentUserId: string;
    endpoint: string;
}

interface UserDialogGroupInviteGroupsResult {
    groups: readonly UserGroupsOverviewGroup[];
    loading: boolean;
    permissionsDegraded: boolean;
    reload: () => void;
}

export function useUserDialogGroupInviteGroups({
    open,
    currentUserId,
    endpoint
}: UserDialogGroupInviteGroupsInput): UserDialogGroupInviteGroupsResult {
    const { t } = useTranslation();
    const [groups, setGroups] = useState<readonly UserGroupsOverviewGroup[]>(
        []
    );
    const [loading, setLoading] = useState(false);
    const [permissionsDegraded, setPermissionsDegraded] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);

    useEffect(() => {
        if (!open) {
            return;
        }

        let active = true;
        setGroups([]);
        setLoading(true);
        setPermissionsDegraded(false);

        groupProfileRepository
            .getUserGroupsOverview({
                userId: currentUserId,
                endpoint,
                force: true
            })
            .then((result) => {
                if (!active) {
                    return;
                }
                setGroups(
                    groupsForInvitePicker(
                        result.groups,
                        result.permissionsDegraded
                    )
                );
                setPermissionsDegraded(result.permissionsDegraded);
            })
            .catch(() => {
                if (active) {
                    toast.error(t('dialog.user.group_invite.load_failed'));
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });

        return () => {
            active = false;
        };
    }, [currentUserId, endpoint, open, reloadToken, t]);

    function reload() {
        setReloadToken((token) => token + 1);
    }

    return {
        groups,
        loading,
        permissionsDegraded,
        reload
    };
}
