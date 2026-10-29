import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import {
    dataDirMigrationErrorKey,
    dataDirMigrationPhaseKey
} from '@/services/dataDirMigrationI18n';
import { wasMutualGraphFetchStartedInThisSession } from '@/services/mutualGraphFetchService';
import {
    profileBackupErrorKey,
    profileBackupPhaseKey
} from '@/services/profileBackupI18n';
import { toast } from '@/services/toastService';
import { useDataDirMigrationStore } from '@/state/dataDirMigrationStore';
import { useProfileBackupStore } from '@/state/profileBackupStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useWorldCollectionImportStore } from '@/state/worldCollectionImportStore';

import { isFriendProfileLoadStatusVisible } from './statusBarFriendProfileLoad';
import { StatusSegment } from './StatusBarParts';

const VISIBLE_MUTUAL_GRAPH_STATUSES = [
    'running',
    'cancelling',
    'completed',
    'cancelled',
    'error'
];

export function DataDirMigrationSegment() {
    const { t } = useTranslation();
    const status = useDataDirMigrationStore((state) => state.status);

    return (
        <StatusSegment
            visible={
                status.state === 'running' ||
                status.state === 'cancelling' ||
                status.state === 'error'
            }
            active={status.state === 'running'}
            warn={status.state === 'error'}
            showDot={false}
            label={
                status.state === 'error'
                    ? t('data_dir_migration.error_short')
                    : t(dataDirMigrationPhaseKey(status.phase))
            }
            value={
                status.percent !== null && status.percent !== undefined
                    ? `${status.percent}%`
                    : undefined
            }
            tooltip={
                status.error
                    ? t(dataDirMigrationErrorKey(status.error.code))
                    : undefined
            }
            className="text-muted-foreground"
            labelClassName={
                status.state === 'error' ? 'text-destructive' : undefined
            }
        />
    );
}

export function ProfileBackupSegment() {
    const { t } = useTranslation();
    const status = useProfileBackupStore((state) => state.status);
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const failed = status.state === 'retryable' || status.state === 'error';

    return (
        <StatusSegment
            visible={status.state !== 'idle'}
            active={status.state === 'running'}
            warn={failed}
            showDot={false}
            label={t(
                status.state === 'running'
                    ? profileBackupPhaseKey(status)
                    : status.state === 'retryable'
                      ? 'profile_backup.retryable_short'
                      : 'profile_backup.error_short'
            )}
            value={
                status.state === 'running' && status.percent !== null
                    ? `${status.percent}%`
                    : undefined
            }
            tooltip={
                status.error
                    ? t(profileBackupErrorKey(status.error.code))
                    : undefined
            }
            onClick={
                failed
                    ? () => setSystemHostOpen('profileBackupOpen', true)
                    : undefined
            }
            className="text-muted-foreground"
            labelClassName={failed ? 'text-destructive' : undefined}
            valueClassName="text-muted-foreground"
        />
    );
}

export function WorldCollectionImportSegment() {
    const { t } = useTranslation();
    const active = useWorldCollectionImportStore((state) => state.active);
    const progress = useWorldCollectionImportStore((state) => state.progress);
    const total = useWorldCollectionImportStore((state) => state.total);

    return (
        <StatusSegment
            visible={active}
            showDot={false}
            label={t('status_bar.world_collection_importing', {
                progress,
                total
            })}
            className="text-muted-foreground"
        />
    );
}

export function FriendProfileLoadSegment() {
    const { t } = useTranslation();
    const status = useRuntimeStore((state) => state.friendProfileLoad.status);
    const processed = useRuntimeStore(
        (state) => state.friendProfileLoad.processedFriends
    );
    const total = useRuntimeStore(
        (state) => state.friendProfileLoad.totalFriends
    );
    let tooltip = t('view.friend_list.loading.loading_friend_details');
    if (status === 'cancelled') {
        tooltip = t('view.friend_list.success.friend_detail_loading_cancelled');
    } else if (status === 'cancelling') {
        tooltip = t('view.friend_list.description.cancelling');
    }

    return (
        <StatusSegment
            visible={isFriendProfileLoadStatusVisible(status)}
            showDot={false}
            label={t(
                status === 'cancelling'
                    ? 'view.friend_list.description.cancelling'
                    : 'view.friend_list.loading.loading_friend_details'
            )}
            value={total > 0 ? `${processed}/${total}` : ''}
            tooltip={tooltip}
            className="text-muted-foreground"
            valueClassName="text-muted-foreground"
        />
    );
}

export function MutualGraphSegment() {
    const { t } = useTranslation();
    const status = useRuntimeStore((state) => state.mutualGraph.status);
    const processed = useRuntimeStore(
        (state) => state.mutualGraph.processedFriends
    );
    const total = useRuntimeStore((state) => state.mutualGraph.totalFriends);
    const lastError = useRuntimeStore((state) => state.mutualGraph.lastError);
    const fetching =
        status === 'running' ||
        status === 'cancelling' ||
        (status === 'completed' && total > 0 && processed >= total);
    let tooltip = t('status_bar.mutual_graph_progress');
    if (status === 'error') {
        tooltip =
            lastError?.trim() ||
            t('view.charts.toast.failed_to_fetch_mutual_friends_graph');
    } else if (status === 'cancelled') {
        tooltip = t(
            'view.charts.label.mutual_graph_fetch_cancelled_the_cached_graph_was_not_replaced'
        );
    }

    return (
        <StatusSegment
            visible={VISIBLE_MUTUAL_GRAPH_STATUSES.includes(status)}
            showDot={false}
            label={
                fetching
                    ? t('status_bar.mutual_graph_fetching')
                    : t('status_bar.mutual_graph')
            }
            value={total > 0 ? `${processed}/${total}` : ''}
            tooltip={tooltip}
            className="text-muted-foreground"
            valueClassName="text-muted-foreground"
        />
    );
}

export function MutualGraphRunToasts() {
    const { t } = useTranslation();
    const runId = useRuntimeStore((state) => state.mutualGraph.runId);
    const status = useRuntimeStore((state) => state.mutualGraph.status);
    const lastError = useRuntimeStore((state) => state.mutualGraph.lastError);
    const observedRunRef = useRef(0);
    const notifiedRunRef = useRef(0);

    useEffect(() => {
        if (!runId) {
            return;
        }

        if (status === 'running' || status === 'cancelling') {
            observedRunRef.current = runId;
            return;
        }

        if (
            (observedRunRef.current !== runId &&
                !wasMutualGraphFetchStartedInThisSession(runId)) ||
            notifiedRunRef.current === runId
        ) {
            return;
        }

        if (status === 'completed') {
            notifiedRunRef.current = runId;
            toast.add({
                type: 'success',
                title: t('view.charts.success.mutual_friends_graph_refreshed')
            });
            return;
        }

        if (status === 'cancelled') {
            notifiedRunRef.current = runId;
            toast.add({
                type: 'warning',
                title: t(
                    'view.charts.label.mutual_graph_fetch_cancelled_the_cached_graph_was_not_replaced'
                )
            });
            return;
        }

        if (status === 'error') {
            notifiedRunRef.current = runId;
            toast.add({
                type: 'error',
                title:
                    lastError ||
                    t('view.charts.toast.failed_to_fetch_mutual_friends_graph')
            });
        }
    }, [lastError, runId, status, t]);

    return null;
}
