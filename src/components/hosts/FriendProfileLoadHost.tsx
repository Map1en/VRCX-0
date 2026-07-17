import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { FriendListUserLoadDialog } from '@/features/friends/components/FriendListUserLoadDialog';
import {
    cancelFriendProfileLoad,
    minimizeFriendProfileLoadDialog
} from '@/services/friendProfileLoadService';
import { useRuntimeStore } from '@/state/runtimeStore';

export function FriendProfileLoadHost() {
    const { t } = useTranslation();
    const notifiedRunRef = useRef(0);
    const runId = useRuntimeStore((state) => state.friendProfileLoad.runId);
    const status = useRuntimeStore((state) => state.friendProfileLoad.status);
    const processedFriends = useRuntimeStore(
        (state) => state.friendProfileLoad.processedFriends
    );
    const totalFriends = useRuntimeStore(
        (state) => state.friendProfileLoad.totalFriends
    );
    const loadedFriends = useRuntimeStore(
        (state) => state.friendProfileLoad.loadedFriends
    );
    const dialogOpen = useRuntimeStore(
        (state) => state.friendProfileLoad.dialogOpen
    );
    const active = status === 'running' || status === 'cancelling';
    const percent = totalFriends
        ? Math.min(100, Math.round((processedFriends / totalFriends) * 100))
        : 0;

    useEffect(() => {
        if (!runId || notifiedRunRef.current === runId) {
            return;
        }
        if (status === 'completed') {
            notifiedRunRef.current = runId;
            if (loadedFriends > 0) {
                toast.success(
                    t('view.friends.dynamic.loaded_value_friend_profiles', {
                        value: loadedFriends
                    })
                );
            }
            return;
        }
        if (status === 'cancelled') {
            notifiedRunRef.current = runId;
            toast.warning(
                t('view.friend_list.success.friend_detail_loading_cancelled')
            );
            return;
        }
        if (status === 'error') {
            notifiedRunRef.current = runId;
            toast.error(
                t('view.friend_list.error.failed_to_load_friend_details')
            );
        }
    }, [loadedFriends, runId, status, t]);

    return (
        <FriendListUserLoadDialog
            open={active && dialogOpen}
            progress={{
                current: processedFriends,
                total: totalFriends,
                cancelled: status === 'cancelling'
            }}
            percent={percent}
            onCancel={cancelFriendProfileLoad}
            onMinimize={minimizeFriendProfileLoadDialog}
        />
    );
}
